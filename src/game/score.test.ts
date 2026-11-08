import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Guess, Verdict } from './round.ts';
import { bestStreak, pointsFor, roundStats, scoreRound, wrongGuesses } from './score.ts';

const g = (guess: Verdict, truth: Verdict, id = `${guess}-${truth}`): Guess => ({ clipId: id, guess, truth, correct: guess === truth, at: 0 });

test('points per decision', () => {
  assert.equal(pointsFor(g('ai', 'ai')), 1);
  assert.equal(pointsFor(g('ai', 'real')), -1);
  assert.equal(pointsFor(g('real', 'real')), 0);
  assert.equal(pointsFor(g('real', 'ai')), 0);
});

test('the score never goes below zero', () => {
  assert.equal(scoreRound([]), 0);
  assert.equal(scoreRound([g('ai', 'real'), g('ai', 'real')]), 0);
  assert.equal(scoreRound([g('ai', 'ai'), g('ai', 'ai'), g('ai', 'real')]), 1);
});

test('stats for an empty round', () => {
  assert.deepEqual(roundStats([]), {
    score: 0,
    judged: 0,
    hits: 0,
    aiSeen: 0,
    falseAlarms: 0,
    correctSkips: 0,
    misses: 0,
    accuracy: 0,
    bestStreak: 0,
  });
});

test('accuracy counts correct skips; AI caught is out of the AI clips judged', () => {
  const s = roundStats([g('ai', 'ai'), g('real', 'real'), g('real', 'ai'), g('ai', 'real'), g('real', 'real')]);
  assert.equal(s.score, 0);
  assert.equal(s.hits, 1);
  assert.equal(s.aiSeen, 2);
  assert.equal(s.falseAlarms, 1);
  assert.equal(s.correctSkips, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.accuracy, 3 / 5);
});

test('spam-skipping and spam-tapping both score poorly', () => {
  const truths: Verdict[] = ['ai', 'real', 'ai', 'real', 'ai', 'real'];
  const skipAll = roundStats(truths.map((t) => g('real', t)));
  const tapAll = roundStats(truths.map((t) => g('ai', t)));
  assert.equal(skipAll.score, 0);
  assert.equal(tapAll.score, 0);
  assert.equal(skipAll.accuracy, 0.5);
});

test('best streak', () => {
  assert.equal(bestStreak([g('ai', 'ai'), g('ai', 'ai'), g('ai', 'real'), g('real', 'real')]), 2);
  assert.equal(bestStreak([g('ai', 'real')]), 0);
});

test('wrong guesses keep their order', () => {
  const list = [g('ai', 'ai', '1'), g('real', 'ai', '2'), g('real', 'real', '3'), g('ai', 'real', '4')];
  assert.deepEqual(
    wrongGuesses(list).map((x) => x.clipId),
    ['2', '4'],
  );
});
