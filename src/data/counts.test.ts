import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsFor, hashString, standInCounts } from './counts.ts';

test('stand-ins are stable per clip and differ between clips', () => {
  assert.deepEqual(standInCounts('x-123'), standInCounts('x-123'));
  assert.notDeepEqual(standInCounts('x-123'), standInCounts('x-124'));
  assert.equal(hashString('abc'), hashString('abc'));
});

test('stand-ins look like real counts: modest mostly, a few big, comments and shares in proportion', () => {
  const all = Array.from({ length: 400 }, (_, i) => standInCounts(`clip-${i}`));
  for (const c of all) {
    assert.ok(c.likes >= 150 && c.likes <= 500_000, String(c.likes));
    // In proportion to likes (give or take rounding).
    assert.ok(c.comments >= 0 && c.comments <= c.likes * 0.02 + 1);
    assert.ok(c.shares >= 1 && c.shares <= c.likes * 0.05 + 1);
  }
  const sorted = all.map((c) => c.likes).sort((a, b) => a - b);
  const median = sorted[200];
  assert.ok(median > 500 && median < 20_000, `median ${median}`);
  assert.ok(sorted[396] > 50_000, 'a few big ones');
});

test('real counts are kept; only clips with none get stand-ins', () => {
  assert.deepEqual(countsFor('a', 5000), { likes: 5000, comments: 60, shares: 150 });
  assert.deepEqual(countsFor('a', 0), standInCounts('a'));
  assert.deepEqual(countsFor('a', null), standInCounts('a'));
});
