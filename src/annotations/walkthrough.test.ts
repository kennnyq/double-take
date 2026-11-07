import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { Tell } from './format.ts';
import { isUnverified, readTell, readTellsFile } from './format.ts';
import { applyReview, buildTellsFile, mergeTells, tellsFileName } from './publish.ts';
import { activeTells, compareMoments, seekTimeFor, stepCopy, walkthroughSteps } from './walkthrough.ts';

const base: Tell = { id: 'a', category: 'continuity', label: 'A', t0: 2, t1: 3, box: { x: 0, y: 0, w: 0.2, h: 0.2 } };

test('every step seeks to a moment where its own box is drawn (paused playback shows it)', () => {
  const tells: Tell[] = [
    { ...base, id: 'late', t0: 6, t1: 7, focusT: 6.4 },
    { ...base, id: 'early', t0: 0, t1: 1 },
    { ...base, id: 'zero', t0: 4, t1: 4.01 },
    { ...base, id: 'badfocus', t0: 8, t1: 9, focusT: 20 },
  ];
  const steps = walkthroughSteps(tells);
  assert.deepEqual(steps.map((s) => s.id), ['early', 'zero', 'late', 'badfocus']);
  for (const s of steps) {
    const t = seekTimeFor(s);
    assert.ok(t >= s.t0 && t <= s.t1, `${s.id} seeks to ${t}`);
    assert.ok(activeTells(tells, t).includes(s), `${s.id} not visible at ${t}`);
  }
  assert.equal(seekTimeFor(tells[0]), 6.4);
});

test('step copy is honest about source and review state', () => {
  const draft: Tell = { ...base, source: 'community_note', review: 'unreviewed', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' };
  const c = stepCopy(draft, 0, 3);
  assert.equal(c.position, 'Step 1 of 3');
  assert.equal(c.source, 'Community Note');
  assert.equal(c.status, 'AI draft · not verified');
  assert.ok(c.unverified);
  assert.match(c.caveat!, /Nemotron/);

  const checked = stepCopy({ ...base, source: 'curator', review: 'spot_checked' }, 1, 3);
  assert.equal(checked.status, 'Checked on frames');
  assert.equal(checked.caveat, undefined);

  const unseen = stepCopy({ ...draft, box: undefined, seenInFrames: false }, 2, 3);
  assert.match(unseen.caveat!, /couldn't find/);

  const comment = stepCopy({ ...draft, source: 'comment', evidence: { quote: 'q', from: 'comment', author: 'kim' } }, 0, 1);
  assert.equal(comment.source, 'Comment by @kim');

  assert.match(stepCopy({ ...draft, model: undefined }, 0, 1).caveat!, /an AI model/);
  // v1 tells without provenance never claim to be verified.
  assert.equal(stepCopy({ ...base }, 0, 1).status, 'Not verified');
  assert.ok(isUnverified({ ...base, source: 'model' }));
});

test('every tells file in the repo reads cleanly (v1: boxed and spot-checked; v2: with provenance)', () => {
  const dir = new URL('../../scripts/harvest/tells/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const file = readTellsFile(raw);
    // Nothing the reader drops: every stored tell is well-formed.
    assert.equal(file.tells.length, raw.tells.length, name);
    if (file.version === 1) {
      for (const t of file.tells) {
        assert.ok(t.box, name);
        assert.equal(t.review, 'spot_checked', name);
      }
    } else {
      assert.ok(file.provenance?.clip.id && name.startsWith(file.provenance.clip.id), name);
      for (const t of file.tells) assert.ok(t.review, `${name}: ${t.id} has a review state`);
    }
  }
});

test('readTell rejects broken essentials and drops broken extras', () => {
  assert.equal(readTell({ label: 'x', t0: 1, t1: 1 }), null);
  assert.equal(readTell({ label: 'x', t0: -1, t1: 1 }), null);
  assert.equal(readTell({ label: ' ', t0: 0, t1: 1 }), null);
  assert.equal(readTell({ label: 'x', t0: 0, t1: 1, box: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }), null);
  const t = readTell({ label: 'x', t0: 0, t1: 1, focusT: 5, source: 'aliens', review: 'yes', confidence: 'sure', evidence: { quote: 1 } }, 3)!;
  assert.deepEqual(t, { id: 'tell-3', category: 'other', label: 'x', t0: 0, t1: 1 });
  assert.deepEqual(readTellsFile('garbage'), { version: 1, tells: [] });
});

test('publishing never overrides hand-checked tells', () => {
  const checked: Tell = { ...base, id: 'checked', review: 'spot_checked', t0: 1, t1: 3 };
  const clash: Tell = { ...base, id: 'draft1', review: 'unreviewed', t0: 2, t1: 4 };
  const fresh: Tell = { ...base, id: 'checked', category: 'text', box: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 }, review: 'unreviewed', t0: 5, t1: 6 };
  const staleDraft: Tell = { ...base, id: 'old', review: 'unreviewed' };
  const r = mergeTells([checked, staleDraft], [clash, fresh]);
  assert.deepEqual(r.tells.map((t) => t.id), ['checked', 'checked-2']);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, /overlaps checked tell/);
});

test('tells files are v2 and round-trip through the app reader', () => {
  assert.equal(tellsFileName('0123456789abcdef'), 'tells.0123456789ab.json');
  const f = buildTellsFile([base], { pipeline: 'annotate@1', generatedAt: '2026-11-07T00:00:00Z', clip: { id: 'x-1' } });
  assert.equal(f.version, 2);
  assert.deepEqual(readTellsFile(JSON.parse(JSON.stringify(f))).tells, [base]);
});

test('review: anyone can reject, only a person can promote, every decision needs a reason', () => {
  const a: Tell = { ...base, id: 'alarm', label: 'Fire alarm disappears', review: 'unreviewed' };
  const b: Tell = { ...base, id: 'dresser', review: 'unreviewed' };
  const at = '2026-11-07T08:00:00Z';
  const r = applyReview(
    [a, b],
    [
      { tell: 'alarm', action: 'reject', by: 'agent', why: 'detector visible in every frame 5.5–8.5s', at },
      { tell: 'dresser', action: 'spot_check', by: 'agent', why: 'looks right', at },
      { tell: 'ghost', action: 'reject', by: 'human', why: 'x', at },
      { tell: 'dresser', action: 'verify', by: 'human', why: '  ', at },
    ],
  );
  assert.deepEqual(r.tells.map((t) => [t.id, t.review]), [['dresser', 'unreviewed']]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].label, 'Fire alarm disappears');
  assert.equal(r.problems.length, 3);
  const h = applyReview([b], [{ tell: 'dresser', action: 'spot_check', by: 'human', why: 'checked 5.5 vs 6.5s', at }]);
  assert.equal(h.tells[0].review, 'spot_checked');
});

test('compareMoments orders before/after by time, whichever frame holds the box', () => {
  const vanish: Tell = { ...base, t0: 4.5, t1: 7, focusT: 5.5, compareT: 6.5 };
  assert.deepEqual(compareMoments(vanish), [
    { label: 'Before', t: 5.5, isFocus: true },
    { label: 'After', t: 6.5, isFocus: false },
  ]);
  const appear: Tell = { ...base, t0: 0, t1: 4, focusT: 3, compareT: 1 };
  assert.deepEqual(compareMoments(appear)!.map((m) => [m.label, m.isFocus]), [
    ['Before', false],
    ['After', true],
  ]);
  assert.equal(compareMoments({ ...base }), null);
  assert.equal(compareMoments({ ...vanish, box: undefined }), null);
});

test('unplaced claims round-trip; malformed entries are dropped', () => {
  const f = readTellsFile({
    version: 2,
    tells: [],
    unplaced: [
      { quote: 'the voice is a standard AI voice', from: 'community_note', reason: 'not_seen', url: 'https://x.com/i/birdwatch/n/1' },
      { quote: 'hooves', from: 'comment', author: 'kim', reason: 'weird' },
      { quote: '', from: 'comment' },
      { quote: 'x', from: 'model' },
      null,
    ],
  });
  assert.deepEqual(f.unplaced, [
    { quote: 'the voice is a standard AI voice', from: 'community_note', reason: 'not_seen', url: 'https://x.com/i/birdwatch/n/1' },
    { quote: 'hooves', from: 'comment', reason: 'not_seen', author: 'kim' },
  ]);
  assert.equal(readTellsFile({ tells: [] }).unplaced, undefined);
});

test('a box-less draft never duplicates a checked tell at the same moment', () => {
  const checked: Tell = { ...base, id: 'arm', category: 'anatomy', review: 'spot_checked', t0: 1.6, t1: 2.4 };
  const boxless: Tell = { id: 'arm2', category: 'text', label: 'Arm morphs', t0: 2, t1: 3, review: 'unreviewed' };
  const later: Tell = { ...boxless, id: 'later', t0: 5, t1: 6 };
  assert.deepEqual(mergeTells([checked], [boxless, later]).tells.map((t) => t.id), ['arm', 'later']);
});
