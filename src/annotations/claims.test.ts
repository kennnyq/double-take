import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFromText } from './categories.ts';
import { claimsPrompt, isGenericClaim, normalizeText, quoteMatches, validateClaims, type SourceText } from './claims.ts';

// Real helpful Community Note on x.com/i/status/2106432142217765020 (2026-11-05 dump).
const NOTE: SourceText = {
  ref: 'note',
  kind: 'community_note',
  text: 'This video is A.i. generated.  At 0:07: the Dresser disappears, the wallpaper becomes different (as do the wall tiles), and what appears to be the fire alarm disappears completely.  https://gijn.org/resource/guide-detecting-ai-generated-content/',
  url: 'https://x.com/i/birdwatch/n/2106588887942316333',
};
const COMMENTS: SourceText[] = [
  { ref: 'comment:1', kind: 'comment', text: 'the sink changes shape when she walks past lol', author: 'someone' },
  { ref: 'comment:2', kind: 'comment', text: 'This is real, I was there', author: 'other' },
];
const SOURCES = [NOTE, ...COMMENTS];

const reply = (claims: unknown[], extra: object = {}) =>
  JSON.stringify({ rationale: 'note says AI', stance: 'claims_ai', claims, comment_stances: [], ...extra });

test('normalizeText and quoteMatches tolerate entities, case and punctuation', () => {
  assert.equal(normalizeText('Fake &quot;policewoman&quot; videos!'), 'fake policewoman videos');
  assert.equal(quoteMatches('the dresser disappears', NOTE.text), 'exact');
  assert.equal(quoteMatches('At 0:07: the Dresser disappears,', NOTE.text), 'exact');
  assert.equal(quoteMatches('the fire alarm disappears completely and the dresser', NOTE.text), 'close');
  assert.equal(quoteMatches('a hand has six fingers', NOTE.text), false);
  assert.equal(quoteMatches('', NOTE.text), false);
});

test('grounded claims survive with their source and time', () => {
  const r = validateClaims(
    reply(
      [
        { source_ref: 'note', quote: 'At 0:07: the Dresser disappears', category: 'continuity', description: 'dresser disappears', time_s: 7, end_s: null, region_hint: null },
        { source_ref: 'comment:1', quote: 'the sink changes shape', category: 'object_morph', description: 'sink changes shape', time_s: null, end_s: null, region_hint: 'sink' },
      ],
      { comment_stances: [{ source_ref: 'comment:1', stance: 'claims_ai' }, { source_ref: 'comment:2', stance: 'says_real' }, { source_ref: 'comment:9', stance: 'says_real' }] },
    ),
    SOURCES,
  );
  assert.equal(r.stance, 'claims_ai');
  assert.equal(r.claims.length, 2);
  assert.deepEqual(
    r.claims.map((c) => [c.id, c.ref, c.t0, c.t1]),
    [
      ['c1', 'note', 7, null],
      ['c2', 'comment:1', null, null],
    ],
  );
  assert.deepEqual(r.commentStances, { 'comment:1': 'claims_ai', 'comment:2': 'says_real' });
});

test('invented quotes are dropped and misattributed ones re-attributed', () => {
  const r = validateClaims(
    reply([
      { source_ref: 'note', quote: 'the woman has six fingers', category: 'anatomy', description: 'six fingers', time_s: 3, end_s: null, region_hint: null },
      { source_ref: 'note', quote: 'the sink changes shape', category: 'object_morph', description: 'sink', time_s: null, end_s: null, region_hint: null },
    ]),
    SOURCES,
  );
  assert.deepEqual(r.claims.map((c) => c.ref), ['comment:1']);
  assert.match(r.issues.join('\n'), /not in any input text/);
  assert.match(r.issues.join('\n'), /re-attributed/);
});

test('times the source never mentions are removed', () => {
  const r = validateClaims(
    reply([{ source_ref: 'comment:1', quote: 'the sink changes shape', category: 'object_morph', description: 'sink', time_s: 4, end_s: 5, region_hint: null }]),
    SOURCES,
  );
  assert.equal(r.claims[0].t0, null);
  assert.match(r.issues.join(), /isn't in comment:1; removed/);
});

test('bad stance, unknown category, duplicates and junk entries are handled', () => {
  const c = { source_ref: 'note', quote: 'the Dresser disappears', category: 'vanishing furniture', description: 'dresser', time_s: '0:07', end_s: null, region_hint: '' };
  const r = validateClaims(
    JSON.stringify({ rationale: 1, stance: 'definitely_ai', claims: [c, c, null, { quote: 'x' }], comment_stances: 'nope' }),
    SOURCES,
  );
  assert.equal(r.stance, 'other');
  assert.equal(r.claims.length, 1);
  assert.equal(r.claims[0].category, 'continuity');
  assert.equal(r.claims[0].t0, 7);
  assert.equal(r.claims[0].regionHint, null);
  assert.match(r.issues.join('\n'), /duplicate/);
  assert.match(r.issues.join('\n'), /missing quote/);
});

test('bracketed refs (real Bolt reply: "[note]") resolve without a warning', () => {
  const r = validateClaims(
    reply([{ source_ref: '[note]', quote: 'the Dresser disappears', category: 'continuity', description: 'dresser', time_s: 7, end_s: null, region_hint: null }], {
      comment_stances: [{ source_ref: '[note]', stance: 'claims_ai' }, { source_ref: '[comment:2]', stance: 'says_real' }],
    }),
    SOURCES,
  );
  assert.equal(r.claims[0].ref, 'note');
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.commentStances, { 'comment:2': 'says_real' });
});

test('non-object replies throw; fenced replies are repaired', () => {
  assert.throws(() => validateClaims('[1,2]', SOURCES), /not a JSON object/);
  assert.throws(() => validateClaims('no json here', SOURCES));
  const r = validateClaims('```json\n' + reply([]) + '\n```', SOURCES);
  assert.equal(r.claims.length, 0);
  assert.match(r.issues.join(), /code fence/);
});

test('claimsPrompt labels each source with its ref', () => {
  const p = claimsPrompt(SOURCES);
  assert.match(p, /^\[note\] \(Community Note\)/);
  assert.match(p, /\[comment:2\] \(comment\)\nThis is real/);
});

test('verdicts are not tells (real Bolt claim: "This video is AI generated content")', () => {
  for (const q of ['This video is AI generated content', 'AI-generated video (Sora-style)', 'this is AI', 'fake']) assert.ok(isGenericClaim(q), q);
  for (const q of ['the Dresser disappears', 'garbled text in the background', 'the voice is one of the standard AI voices']) assert.ok(!isGenericClaim(q), q);
  const note: SourceText = { ref: 'note', kind: 'community_note', text: 'This video is AI generated content. The arm becomes a leg.' };
  const r = validateClaims(
    reply([
      { source_ref: 'note', quote: 'This video is AI generated content', category: 'other', description: 'AI generated content', time_s: null, end_s: null, region_hint: null },
      { source_ref: 'note', quote: 'The arm becomes a leg', category: 'anatomy', description: 'arm becomes leg', time_s: null, end_s: null, region_hint: null },
    ]),
    [note],
  );
  assert.deepEqual(r.claims.map((c) => c.quote), ['The arm becomes a leg']);
  assert.match(r.issues.join(), /a verdict, not a tell/);
});

test('the quote decides the category when it clearly names one (real Bolt reply: arm→leg labelled "text")', () => {
  const note: SourceText = { ref: 'note', kind: 'community_note', text: "the woman's arm morphs into a leg and foot around 2 seconds in" };
  const r = validateClaims(
    reply([{ source_ref: 'note', quote: "the woman's arm morphs into a leg and foot", category: 'text', description: 'AI-generated artifact', time_s: 2, end_s: null, region_hint: null }]),
    [note],
  );
  assert.equal(r.claims[0].category, 'anatomy');
  assert.match(r.issues.join(), /text → anatomy from the quote/);
  assert.equal(categoryFromText('garbled licenses'), 'text');
  assert.equal(categoryFromText('the blurring of the Sora logo'), 'watermark');
  assert.equal(categoryFromText('vehicle anomalies'), null);
});
