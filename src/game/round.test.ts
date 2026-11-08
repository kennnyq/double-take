import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from './config.ts';
import { countdownProgress, createRound, elapsed, remaining, roundReducer, type Card, type RoundEvent, type RoundState } from './round.ts';

const deck: Card[] = [
  { id: 'a', truth: 'ai' },
  { id: 'b', truth: 'real' },
  { id: 'c', truth: 'ai' },
  { id: 'd', truth: 'real' },
];

const run = (s: RoundState, ...events: RoundEvent[]) => events.reduce(roundReducer, s);

/** A round that started playing at t=1000 (countdown from 1000 − countdownMs). */
function playing(d: readonly Card[] = deck, durationMs = 60_000): RoundState {
  const s = run(createRound(d, durationMs), { type: 'START', now: 1000 - GAME.countdownMs }, { type: 'GO', now: 1000 });
  assert.equal(s.phase, 'playing');
  return s;
}

test('starts ready with the full round left', () => {
  const s = createRound(deck, 60_000);
  assert.equal(s.phase, 'ready');
  assert.equal(remaining(s, 123), 60_000);
  assert.equal(s.index, 0);
});

test('START counts down, then GO (or a TICK past the countdown) starts play', () => {
  const s = roundReducer(createRound(deck), { type: 'START', now: 0 });
  assert.equal(s.phase, 'countdown');
  assert.equal(s.countdownEnd, GAME.countdownMs);
  assert.equal(countdownProgress(s, GAME.countdownMs / 2), 0.5);
  assert.equal(roundReducer(s, { type: 'TICK', now: GAME.countdownMs - 1 }).phase, 'countdown');
  const ticked = roundReducer(s, { type: 'TICK', now: GAME.countdownMs + 40 });
  assert.equal(ticked.phase, 'playing');
  // Play starts when the countdown ended, not when the late tick came.
  assert.equal(ticked.deadline, GAME.countdownMs + GAME.roundMs);
  const went = roundReducer(s, { type: 'GO', now: 5000 });
  assert.equal(went.deadline, 5000 + GAME.roundMs);
});

test('events in the wrong phase are ignored', () => {
  const ready = createRound(deck);
  for (const type of ['GO', 'MARK_AI', 'SKIP', 'PAUSE', 'RESUME', 'TICK'] as const) {
    assert.equal(roundReducer(ready, { type, now: 10 }), ready, type);
  }
  const p = playing();
  assert.equal(roundReducer(p, { type: 'START', now: 2000 }), p);
  assert.equal(roundReducer(p, { type: 'GO', now: 2000 }), p);
  assert.equal(roundReducer(p, { type: 'RESUME', now: 2000 }), p);
  const over = roundReducer(p, { type: 'QUIT', now: 2000 });
  for (const type of ['START', 'GO', 'MARK_AI', 'SKIP', 'PAUSE', 'RESUME', 'TICK', 'QUIT'] as const) {
    assert.equal(roundReducer(over, { type, now: 3000 }), over, type);
  }
});

test('marking and skipping record guesses and advance', () => {
  const s = run(playing(), { type: 'MARK_AI', now: 2000 }, { type: 'MARK_AI', now: 3500 }, { type: 'SKIP', now: 4000 });
  assert.equal(s.index, 3);
  assert.deepEqual(
    s.guesses.map((g) => [g.clipId, g.guess, g.truth, g.correct, g.at]),
    [
      ['a', 'ai', 'ai', true, 1000],
      ['b', 'ai', 'real', false, 2500],
      ['c', 'real', 'ai', false, 3000],
    ],
  );
});

test('a gesture on a clip the round has moved past does nothing', () => {
  const s = run(playing(), { type: 'MARK_AI', now: 2000, index: 0 });
  assert.equal(s.index, 1);
  assert.equal(roundReducer(s, { type: 'SKIP', now: 2100, index: 0 }), s);
  assert.equal(roundReducer(s, { type: 'SKIP', now: 2100, index: 1 }).index, 2);
});

test('the deck running out ends the round early', () => {
  const s = run(playing(deck.slice(0, 2)), { type: 'SKIP', now: 2000 }, { type: 'SKIP', now: 3000 });
  assert.equal(s.phase, 'over');
  assert.equal(s.endReason, 'deck');
  assert.equal(s.guesses.length, 2);
  assert.equal(s.remainingMs, 58_000);
});

test('an empty deck ends at once', () => {
  const s = run(createRound([]), { type: 'START', now: 0 }, { type: 'GO', now: 3000 });
  assert.equal(s.phase, 'over');
  assert.equal(s.endReason, 'deck');
});

test('TICK ends the round at the deadline; the clip on screen is not judged', () => {
  const s = playing(deck, 10_000);
  assert.equal(roundReducer(s, { type: 'TICK', now: 10_999 }), s);
  const over = roundReducer(s, { type: 'TICK', now: 11_000 });
  assert.equal(over.phase, 'over');
  assert.equal(over.endReason, 'time');
  assert.equal(remaining(over, 99_999), 0);
  // A gesture that lands after the deadline but before the tick isn't counted either.
  const late = roundReducer(s, { type: 'MARK_AI', now: 11_050 });
  assert.equal(late.phase, 'over');
  assert.equal(late.guesses.length, 0);
});

test('pause freezes the clock; resume counts down and rebuilds the deadline', () => {
  const s = playing(deck, 60_000);
  const paused = roundReducer(s, { type: 'PAUSE', now: 21_000 });
  assert.equal(paused.phase, 'paused');
  assert.equal(remaining(paused, 21_000), 40_000);
  // Hours in the background change nothing.
  assert.equal(remaining(paused, 9_000_000), 40_000);
  assert.equal(roundReducer(paused, { type: 'TICK', now: 9_000_000 }), paused);
  assert.equal(roundReducer(paused, { type: 'MARK_AI', now: 9_000_000 }), paused);
  const resumed = roundReducer(paused, { type: 'RESUME', now: 9_000_000 });
  assert.equal(resumed.phase, 'countdown');
  const back = roundReducer(resumed, { type: 'TICK', now: 9_000_000 + GAME.countdownMs });
  assert.equal(back.phase, 'playing');
  assert.equal(remaining(back, 9_000_000 + GAME.countdownMs), 40_000);
  assert.equal(elapsed(back, 9_000_000 + GAME.countdownMs + 5_000), 25_000);
});

test('pausing during a countdown keeps the time and restarts the countdown on resume', () => {
  const s = run(createRound(deck, 60_000), { type: 'START', now: 0 }, { type: 'PAUSE', now: 1000 });
  assert.equal(s.phase, 'paused');
  assert.equal(s.remainingMs, 60_000);
  const r = roundReducer(s, { type: 'RESUME', now: 50_000 });
  assert.equal(r.countdownEnd, 50_000 + GAME.countdownMs);
});

test('quitting ends the round and keeps what was played', () => {
  const s = run(playing(), { type: 'MARK_AI', now: 2000 }, { type: 'QUIT', now: 3000 });
  assert.equal(s.phase, 'over');
  assert.equal(s.endReason, 'quit');
  assert.equal(s.guesses.length, 1);
});

test('untimed: straight into play, judged at its own pace, the deck growing as it is dealt', () => {
  let s = createRound(deck.slice(0, 2), 60_000, false);
  s = roundReducer(s, { type: 'START', now: 100 });
  assert.equal(s.phase, 'playing');
  assert.equal(s.deadline, null);
  assert.equal(remaining(s, 9e12), Infinity);
  // No clock: ticks, pauses and hours away change nothing.
  assert.equal(roundReducer(s, { type: 'TICK', now: 9e12 }), s);
  assert.equal(roundReducer(s, { type: 'PAUSE', now: 9e12 }), s);
  s = run(s, { type: 'MARK_AI', now: 1100 }, { type: 'SKIP', now: 5100 });
  assert.equal(s.phase, 'playing', 'running out of cards only waits');
  assert.deepEqual(
    s.guesses.map((g) => [g.clipId, g.guess, g.correct, g.at]),
    [
      ['a', 'ai', true, 1000],
      ['b', 'real', true, 5000],
    ],
  );
  assert.equal(roundReducer(s, { type: 'MARK_AI', now: 6000 }), s, 'nothing to judge until more are dealt');
  s = roundReducer(s, { type: 'DEAL', cards: deck.slice(2) });
  assert.equal(s.deck.length, 4);
  s = roundReducer(s, { type: 'MARK_AI', now: 7000 });
  assert.equal(s.guesses.length, 3);
  assert.equal(s.index, 3);
});

test('a timed round deals once: DEAL only grows a deck while not over', () => {
  const over = roundReducer(playing(), { type: 'QUIT', now: 2000 });
  assert.equal(roundReducer(over, { type: 'DEAL', cards: deck }), over);
});
