import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_LINE_DURATION, REVEAL_LINE_MS, lineDelays, lineProgress, revealTimes, wipeEdge } from './reveal.ts';

test('lines start one after another from the top; the hint follows the last', () => {
  assert.deepEqual(lineDelays(3), [0, REVEAL_LINE_MS, 2 * REVEAL_LINE_MS]);
  assert.deepEqual(lineDelays(0), []);
  const { hint, total } = revealTimes(3);
  assert.ok(hint > 2 * REVEAL_LINE_MS);
  assert.equal(total, hint + REVEAL_LINE_DURATION);
});

test('lineProgress eases from 0 to 1 over a line’s duration', () => {
  assert.equal(lineProgress(0, 50), 0);
  assert.equal(lineProgress(50 + REVEAL_LINE_DURATION, 50), 1);
  const mid = lineProgress(50 + REVEAL_LINE_DURATION / 2, 50);
  assert.ok(mid > 0.5 && mid < 1, `${mid}`); // ease out: past half at half time
});

test('wipeEdge sweeps from above the block to past it', () => {
  assert.ok(wipeEdge(0, 500) < 0);
  assert.ok(wipeEdge(500, 500) > 100);
  assert.ok(wipeEdge(250, 500) > wipeEdge(100, 500));
});
