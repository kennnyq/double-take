import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Claim, SourceText } from './claims.ts';
import { DRAFT_SCHEMA, MAX_TELLS, claimLabel, draftPrompt, readsAsDenial, validateDraft, type DraftContext, type SampledFrame } from './draft.ts';
import { readTell } from './format.ts';

const NOTE: SourceText = {
  ref: 'note',
  kind: 'community_note',
  text: 'This video is A.i. generated.  At 0:07: the Dresser disappears, the wallpaper becomes different (as do the wall tiles), and what appears to be the fire alarm disappears completely.',
  url: 'https://x.com/i/birdwatch/n/2106588887942316333',
};
const CLAIMS: Claim[] = [
  { id: 'c1', ref: 'note', quote: 'the Dresser disappears', category: 'continuity', description: 'dresser disappears', t0: 7, t1: 7, regionHint: null },
  { id: 'c2', ref: 'note', quote: 'the wallpaper becomes different', category: 'background_shift', description: 'wallpaper changes', t0: 7, t1: 7, regionHint: null },
  { id: 'c3', ref: 'note', quote: 'the fire alarm disappears completely', category: 'continuity', description: 'fire alarm disappears', t0: 7, t1: 7, regionHint: null },
];
const FRAMES: SampledFrame[] = [0, 1.5, 3, 4.5, 5.5, 6, 6.5, 7, 7.5, 9, 10.5].map((t, index) => ({ index, t, w: 432, h: 768 }));
const CTX: DraftContext = { duration: 10.75, frames: FRAMES, claims: CLAIMS, sources: [NOTE], model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' };

const tell = (o: object) => ({
  claim_id: 'c1',
  category: 'continuity',
  label: 'Dresser vanishes',
  explanation: 'The maroon dresser at bottom left is gone a second later.',
  frame: 4,
  t0: 5.5,
  t1: 6.5,
  bbox_2d: [0, 500, 208, 725],
  visible: 'yes',
  confidence: 'high',
  ...o,
});
const run = (tells: unknown[], ctx: Partial<DraftContext> = {}) => validateDraft(JSON.stringify({ tells }), { ...CTX, ...ctx });

test('a good draft becomes an app tell with provenance and stays unreviewed', () => {
  const r = run([tell({})], { claims: [CLAIMS[0]] });
  assert.equal(r.tells.length, 1);
  const t = r.tells[0];
  assert.deepEqual(t.box, { x: 0, y: 0.5, w: 0.208, h: 0.225 });
  assert.equal(t.focusT, 5.5);
  assert.ok(t.t0 <= 5.5 && t.t1 >= 5.5 && t.t1 - t.t0 >= 1);
  assert.equal(t.source, 'community_note');
  assert.equal(t.review, 'unreviewed');
  assert.equal(t.seenInFrames, true);
  assert.equal(t.evidence?.quote, 'the Dresser disappears');
  assert.equal(t.evidence?.url, NOTE.url);
  assert.equal(t.model, CTX.model);
  assert.equal(t.id, 'dresser-vanishes');
  assert.deepEqual(r.coverage, { c1: 'boxed' });
  // The app's reader accepts exactly what the validator produces.
  assert.deepEqual(readTell(JSON.parse(JSON.stringify(t))), t);
});

test('model-only findings are held back unless allowed (blind VLMs hallucinated in the PoC)', () => {
  const r = run([tell({ claim_id: null, label: 'Man appears in doorway', bbox_2d: [375, 180, 450, 300] })], { claims: [] });
  assert.equal(r.tells.length, 0);
  assert.match(r.rejected[0].reason, /model-only/);
  const allowed = run([tell({ claim_id: null, confidence: 'high' })], { claims: [], allowModelOnly: true });
  assert.equal(allowed.tells[0].source, 'model');
  assert.equal(allowed.tells[0].confidence, 'low');
  assert.equal(allowed.tells[0].evidence, undefined);
});

test('"not visible" drops the box but keeps the claim as an honest box-less step', () => {
  const r = run([tell({ visible: 'no' })], { claims: [CLAIMS[0]] });
  assert.equal(r.tells.length, 1);
  assert.equal(r.tells[0].box, undefined);
  assert.equal(r.tells[0].seenInFrames, false);
  assert.deepEqual(r.coverage, { c1: 'unboxed' });
});

test('claims the model skipped become box-less steps at the claimed time', () => {
  const r = run([tell({})]);
  assert.deepEqual(r.coverage, { c1: 'boxed', c2: 'unboxed', c3: 'unboxed' });
  const unplaced = r.tells.filter((t) => !t.box);
  assert.equal(unplaced.length, 2);
  for (const t of unplaced) {
    assert.ok(t.t0 <= 7 && t.t1 >= 7);
    assert.equal(t.confidence, 'low');
    assert.match(t.detail!, /couldn't place it/);
  }
  assert.equal(run([tell({})], { keepUnplacedClaims: false }).tells.length, 1);
});

test('duplicates collapse to the strongest (real PoC failure: Omni repeated every claim)', () => {
  const r = run([tell({ confidence: 'low', bbox_2d: null, visible: 'unsure' }), tell({}), tell({ label: 'dresser vanishes', frame: 5, t0: 6 })], {
    claims: [CLAIMS[0]],
  });
  assert.equal(r.tells.length, 1);
  assert.ok(r.tells[0].box);
  assert.equal(r.rejected.filter((x) => /duplicate/.test(x.reason)).length, 2);
});

test('broken entries are rejected with reasons, the rest still publish', () => {
  const r = run(
    [
      null,
      'nope',
      tell({ label: '', explanation: '', claim_id: 'zz' }),
      tell({ frame: 99, t0: null, t1: null, claim_id: 'zz' }),
      tell({ claim_id: 'c3', label: 'Smoke detector vanishes', bbox_2d: [447, 112, 525, 162], frame: 7 }),
    ],
    { claims: CLAIMS, keepUnplacedClaims: false, allowModelOnly: false },
  );
  assert.deepEqual(r.tells.map((t) => t.label), ['Smoke detector vanishes']);
  assert.equal(r.rejected.length, 4);
  assert.match(r.issues.join('\n'), /frame 99 wasn't sent/);
});

test('bad boxes are dropped without losing the timed claim', () => {
  const r = run([tell({ bbox_2d: [0, 0, 1000, 1000] }), tell({ claim_id: 'c3', label: 'Alarm', bbox_2d: ['x', 1, 2, 3], frame: 7 })], {
    keepUnplacedClaims: false,
  });
  assert.equal(r.tells.length, 2);
  assert.ok(r.tells.every((t) => !t.box));
  assert.match(r.issues.join('\n'), /100% of the frame/);
  assert.match(r.issues.join('\n'), /non-numeric/);
});

test('a box with no frame index is tied to the frame nearest its time', () => {
  const r = run([tell({ frame: undefined, t0: 6.1 })], { claims: [CLAIMS[0]] });
  assert.equal(r.tells[0].focusT, 6);
  assert.match(r.issues.join(), /tied to frame 5/);
});

test('letterbox crop is undone so boxes land on the full frame', () => {
  const crop = { x: 0, y: 0.25, w: 1, h: 0.5 };
  const r = run([tell({ bbox_2d: [0, 0, 500, 500] })], { claims: [CLAIMS[0]], crop });
  assert.deepEqual(r.tells[0].box, { x: 0, y: 0.25, w: 0.5, h: 0.25 });
});

test('never more than MAX_TELLS, ordered by time, unique ids', () => {
  const many = Array.from({ length: 8 }, (_, i) =>
    tell({ claim_id: null, label: 'Same label', frame: i, t0: FRAMES[i].t, bbox_2d: [i * 100, 0, i * 100 + 90, 90] }),
  );
  const r = run(many, { claims: [], allowModelOnly: true });
  assert.equal(r.tells.length, MAX_TELLS);
  const ts = r.tells.map((t) => t.t0);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.equal(new Set(r.tells.map((t) => t.id)).size, MAX_TELLS);
});

test('unparseable and wrong-shape replies throw', () => {
  assert.throws(() => validateDraft('sorry, no', CTX));
  assert.throws(() => validateDraft('{"answer": 42}', CTX), /no tells array/);
});

// ---- real recorded model replies -------------------------------------------
const POC = JSON.parse(readFileSync(new URL('./fixtures/poc-2026-11-06.json', import.meta.url), 'utf8')) as {
  vlm: { tweetId: string; mode: string; model: string; result: unknown }[];
};

test('real PoC replies (older "events" shape) validate without crashing and publish nothing bogus', () => {
  for (const r of POC.vlm) {
    const out = validateDraft(r.result, { ...CTX, duration: 15, claims: [], frames: [], model: r.model });
    // No claim ids in those replies, so everything is model-only: held back.
    assert.equal(out.tells.length, 0, `${r.tweetId} ${r.mode}`);
    assert.match(out.issues.join(), /older "events" shape/);
  }
  // Allowing model-only output shows what would have leaked: full-frame boxes must be stripped.
  const guided = POC.vlm.find((r) => r.tweetId === '2106432142217765020' && r.mode === 'guided')!;
  const out = validateDraft(guided.result, { ...CTX, duration: 15, claims: [], frames: [], model: guided.model, allowModelOnly: true });
  assert.ok(out.tells.every((t) => !t.box), 'whole-frame [0,0,1000,1000] boxes must not survive');
  assert.ok(out.tells.length <= 3, 'six repeated events collapse');
});

test('prompt and schema are what the model is asked for', () => {
  const p = draftPrompt(CLAIMS, 10.75);
  assert.match(p, /10\.8 s long/);
  assert.match(p, /c1: dresser disappears \(note says ~7s\)/);
  assert.deepEqual(DRAFT_SCHEMA.required, ['tells']);
  assert.ok(DRAFT_SCHEMA.properties.tells.items.required.includes('bbox_2d'));
  assert.ok(DRAFT_SCHEMA.properties.tells.items.required.includes('card_side'));
});

test('card_side becomes the tell placement; anything else is dropped', () => {
  const [top] = run([tell({ card_side: 'top' })], { claims: [CLAIMS[0]] }).tells;
  assert.equal(top.placement, 'top');
  assert.deepEqual(readTell(JSON.parse(JSON.stringify(top))), top);
  const [none] = run([tell({ card_side: 'middle' })], { claims: [CLAIMS[0]] }).tells;
  assert.equal(none.placement, undefined);
});

test('after_frame becomes a before/after moment; bad ones are ignored with a note', () => {
  const ok = run([tell({ frame: 4, after_frame: 6 })], { claims: [CLAIMS[0]] }).tells[0];
  assert.equal(ok.focusT, 5.5);
  assert.equal(ok.compareT, 6.5);
  assert.ok(ok.t0 <= 5.5 && ok.t1 >= 6.5);
  assert.deepEqual(readTell(JSON.parse(JSON.stringify(ok))), ok);

  for (const [after, why] of [
    [99, /wasn't sent/],
    [4, /is the box frame/],
    [10, /too far/],
  ] as const) {
    const r = run([tell({ frame: 4, after_frame: after })], { claims: [CLAIMS[0]] });
    assert.equal(r.tells[0].compareT, undefined);
    assert.match(r.issues.join(), why);
  }
  // No box, no comparison.
  assert.equal(run([tell({ visible: 'no', after_frame: 6 })], { claims: [CLAIMS[0]] }).tells[0].compareT, undefined);
});

test('denials from the 2026-11-07 live run are recognised; real tells are not', () => {
  for (const denial of [
    'Mouths and eyes look normal',
    'Text is clear and readable',
    'License plates remain legible',
    'Shadows stay consistent',
    'No Sora logo visible in upper right',
    'No AI artifacts detected',
    'Goat climbs rock face normally',
    'Eyes too small to judge light reflection',
    'No audio available to check hoof sounds',
  ]) {
    assert.ok(readsAsDenial(denial), denial);
  }
  for (const tell of [
    'Dresser vanishes behind her',
    'Trailer disappears after impact instead of realistic physics',
    "Handler's hand stays on cat's leg",
    'Handler fails to release the leg',
    'Paws pass through each other',
    'Woman moves unnaturally',
    'Fingernail visible at 7s',
    'Container text changes from CAT to gibberish',
  ]) {
    assert.ok(!readsAsDenial(tell), tell);
  }
});

test('a denial never becomes the tell text: untimed claims go to "unplaced", timed ones keep the claim words', () => {
  const untimed: Claim = { id: 'u1', ref: 'note', quote: 'the Dresser disappears', category: 'continuity', description: 'AI tell', t0: null, t1: null, regionHint: null };
  const r = run([tell({ claim_id: 'u1', label: 'Dresser looks normal', visible: 'yes' })], { claims: [untimed] });
  assert.equal(r.tells.length, 0);
  assert.deepEqual(r.unplaced, [{ quote: 'the Dresser disappears', from: 'community_note', reason: 'not_seen', url: NOTE.url }]);
  assert.deepEqual(r.coverage, { u1: 'unplaced' });
  assert.match(r.issues.join(), /contradicts the claim/);

  const timed = run([tell({ label: 'No dresser change visible', visible: 'no' })], { claims: [CLAIMS[0]] });
  const t = timed.tells[0];
  assert.equal(t.label, 'Dresser disappears');
  assert.equal(t.box, undefined);
  assert.equal(t.seenInFrames, false);
  assert.ok(t.t0 <= 7 && t.t1 >= 7, 'placed at the note time, not the model frame');
  assert.match(t.detail!, /couldn't find it/);
});

test('claims the model skipped without a source time are listed as unplaced (not_checked)', () => {
  const untimed: Claim = { id: 'u1', ref: 'note', quote: 'the wallpaper becomes different', category: 'background_shift', description: 'wallpaper changes', t0: null, t1: null, regionHint: null };
  const r = run([], { claims: [untimed] });
  assert.deepEqual(r.unplaced.map((u) => u.reason), ['not_checked']);
  assert.equal(r.tells.length, 0);
});

test('claimLabel uses the quote when the model wrote a generic description', () => {
  const c: Claim = { id: 'c', ref: 'note', quote: 'bobcat cub’s spots/ear tufts shift', category: 'anatomy', description: 'AI tell', t0: null, t1: null, regionHint: null };
  assert.equal(claimLabel(c), 'Bobcat cub’s spots/ear tufts shift');
  assert.equal(claimLabel({ ...c, description: 'trailer wheels vanish mid-crash' }), 'Trailer wheels vanish mid-crash');
  assert.equal(claimLabel({ ...c, description: 'AI-generated video (Sora-style)' }), 'Bobcat cub’s spots/ear tufts shift');
});
