import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_LINE_MS, REVEAL_WORD_STAGGER_MS, revealDelays } from './reveal.ts';

test('revealDelays: line by line from the top, a little left to right within a line', () => {
  // Two lines of three and two words (tops at 0 and 20).
  const d = revealDelays([0, 0, 0, 20, 20]);
  assert.deepEqual(d, [0, REVEAL_WORD_STAGGER_MS, 2 * REVEAL_WORD_STAGGER_MS, REVEAL_LINE_MS, REVEAL_LINE_MS + REVEAL_WORD_STAGGER_MS]);
});

test('revealDelays: sub-pixel tops count as one line, and a later line always starts later', () => {
  const d = revealDelays([0.2, 0.4, 19.8, 40.1]);
  assert.equal(d[0], 0);
  assert.equal(d[1], REVEAL_WORD_STAGGER_MS);
  assert.ok(d[2] > d[1] && d[3] > d[2]);
  assert.deepEqual(revealDelays([]), []);
});
