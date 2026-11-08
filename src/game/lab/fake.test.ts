import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRound } from './fake.ts';

const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('the asked shares of right answers and AI clips', () => {
  const f = fakeRound(pool, { judged: 20, right: 0.75, ai: 0.5, timeUp: false });
  assert.equal(f.round.guesses.length, 20);
  assert.equal(f.round.guesses.filter((g) => g.correct).length, 15);
  assert.equal(f.round.deck.filter((c) => c.truth === 'ai').length, 10);
  assert.equal(f.stats.judged, 20);
  assert.equal(f.round.phase, 'over');
  assert.ok(f.round.guesses.every((g) => (g.guess === g.truth) === g.correct));
});

test('time up leaves one more clip not judged; short pools repeat', () => {
  const f = fakeRound(pool, { judged: 7, right: 1, ai: 0.5, timeUp: true });
  assert.equal(f.round.deck.length, 8);
  assert.equal(f.round.endReason, 'time');
  assert.equal(f.round.index, 7);
  assert.equal(f.clips.size, 8);
  assert.equal(f.stats.accuracy, 1);
});

test('extremes', () => {
  assert.equal(fakeRound(pool, { judged: 0, right: 0.5, ai: 0.5, timeUp: false }).round.guesses.length, 0);
  const allWrong = fakeRound(pool, { judged: 10, right: 0, ai: 1, timeUp: false });
  assert.equal(allWrong.stats.score, 0);
  assert.equal(allWrong.stats.misses, 10);
});
