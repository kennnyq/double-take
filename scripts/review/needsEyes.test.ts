import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SCHEMA, NeedsEyesFile, VENDORED_SCHEMA, eyesKey, parseNeedsEyes, validate } from './needsEyes.ts';

const SCHEMA = JSON.parse(readFileSync(VENDORED_SCHEMA, 'utf8'));
const hex = (c: string) => c.repeat(64);
const item = (over: object = {}) => ({
  id: hex('a'),
  rank: 1,
  status: 'open',
  clipId: 'x-1',
  reason: 'conflicting_evidence',
  question: 'Does the hand really pass through the cup at 0:04?',
  whyHumanHelps: 'Two models disagree and the pixel check is inconclusive.',
  evidenceRefs: ['tells/main#t1'],
  attemptedChecks: ['pixel-diff'],
  ...over,
});
const doc = (items: unknown[], over: object = {}) =>
  JSON.stringify({
    version: 1,
    generatedAt: '2026-11-08T09:07:12.971Z',
    automaticResultsContinue: true,
    feedbackJournalSha256: null,
    candidatesExamined: items.length,
    openCount: items.length,
    rejectedRequests: 0,
    items,
    ...over,
  });

test('the vendored schema matches the hill climb’s, when that checkout is here', (t) => {
  if (!existsSync(DEFAULT_SCHEMA)) return t.skip('hill climb checkout not present');
  assert.deepEqual(JSON.parse(readFileSync(DEFAULT_SCHEMA, 'utf8')), SCHEMA);
});

test('today’s file (no items) reads as an empty, valid queue', () => {
  const r = parseNeedsEyes(doc([]), SCHEMA, 'p');
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
  assert.equal(r.generatedAt, '2026-11-08T09:07:12.971Z');
});

test('items come back by rank; a bad item is left out and reported, the rest stay', () => {
  const r = parseNeedsEyes(
    doc([
      item({ id: hex('b'), rank: 2, sourceClipId: 'yt-abcdefghijk', timeRange: { t0: 3.5, t1: 5 } }),
      item({ id: hex('c'), rank: 1 }),
      item({ id: 'short', rank: 3 }),
      item({ id: hex('d'), rank: 4, reason: 'vibes' }),
      item({ id: hex('e'), rank: 5, extra: true }),
    ]),
    SCHEMA,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((i) => i.rank), [1, 2]);
  assert.deepEqual(r.invalid.map((i) => i.index), [2, 3, 4]);
  assert.match(r.invalid[0].errors[0], /\.id: doesn't match/);
  assert.match(r.invalid[1].errors[0], /\.reason: must be one of/);
  assert.match(r.invalid[2].errors[0], /\.extra: not allowed/);
  assert.equal(eyesKey(r.items[1]), 'yt-abcdefghijk', 'matched by sourceClipId first');
  assert.equal(eyesKey(r.items[0]), 'x-1');
});

test('an invalid envelope, bad JSON or an empty file are handled, never thrown', () => {
  assert.equal(parseNeedsEyes(doc([], { version: 2 }), SCHEMA).ok, false);
  assert.match(String(parseNeedsEyes(doc([], { surprise: 1 }), SCHEMA).error), /not allowed/);
  assert.match(String(parseNeedsEyes('{nope', SCHEMA).error), /not JSON/);
  assert.deepEqual(parseNeedsEyes('  \n', SCHEMA).items, []);
  assert.equal(parseNeedsEyes('  \n', SCHEMA).ok, true);
});

test('validate covers the keywords the schema uses', () => {
  const s = { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 1 }, t: { type: 'number', exclusiveMinimum: 0 } }, additionalProperties: false };
  assert.deepEqual(validate(s, { n: 2, t: 0.5 }), []);
  assert.deepEqual(validate(s, { n: 1.5 }), ['$.n: expected integer']);
  assert.deepEqual(validate(s, { n: 0, t: 0 }), ['$.n: below 1', '$.t: must be above 0']);
  assert.deepEqual(validate({ type: ['string', 'null'] }, null), []);
  assert.deepEqual(validate({ type: 'string', format: 'date-time' }, 'yesterday'), ['$: not a date-time']);
});

test('NeedsEyesFile: a missing file is an empty queue; changes are picked up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyes-'));
  const p = join(dir, 'needs-eyes.v1.json');
  const f = new NeedsEyesFile(p, VENDORED_SCHEMA);
  assert.deepEqual([f.read().ok, f.read().exists, f.read().items.length], [true, false, 0]);
  writeFileSync(p, doc([]));
  assert.equal(f.read().items.length, 0);
  writeFileSync(p, doc([item(), item({ id: hex('f'), rank: 2, clipId: 'x-2' })]));
  utimesSync(p, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(f.read().items.map((i) => i.clipId), ['x-1', 'x-2']);
});
