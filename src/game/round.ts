/**
 * One timed round as a pure reducer: ready → countdown → playing ⇄ paused
 * (→ countdown) → over. No React Native imports, so it runs under `node --test`.
 *
 * The same reducer runs the untimed game (the Game tab): no countdown, no
 * deadline and no pause, the deck growing as it's dealt (`DEAL`), until the
 * player leaves.
 *
 * Time is never decremented. While playing, the round holds a `deadline` on
 * the caller's monotonic clock (`performance.now()`), and what's left is
 * `deadline − now`. Pausing stores what's left; resuming builds a new deadline
 * once the countdown ends. So timers can't drift, and time spent in the
 * background is neither lost nor gained.
 */
import { GAME } from './config.ts';

export type Verdict = 'ai' | 'real';
export type Phase = 'ready' | 'countdown' | 'playing' | 'paused' | 'over';
export type EndReason = 'time' | 'deck' | 'quit';

/** One clip of the round's deck: its id and the truth. */
export interface Card {
  id: string;
  truth: Verdict;
}

export interface Guess {
  clipId: string;
  /** Marked AI, or skipped (which counts as calling it real). */
  guess: Verdict;
  truth: Verdict;
  correct: boolean;
  /** ms into the round's play time. */
  at: number;
}

export interface RoundState {
  phase: Phase;
  deck: readonly Card[];
  /** The clip on screen. */
  index: number;
  guesses: readonly Guess[];
  durationMs: number;
  /** While playing: when the round ends, on the caller's clock. */
  deadline: number | null;
  /** Play time left; current while not playing (see `remaining`). */
  remainingMs: number;
  /** While counting down: when play starts. */
  countdownEnd: number | null;
  endReason: EndReason | null;
  /** False: the untimed game (no countdown, no deadline). */
  timed: boolean;
  /** When play started, on the caller's clock (an untimed guess's `at` counts from here). */
  startedAt: number | null;
}

export type RoundEvent =
  | { type: 'START'; now: number }
  | { type: 'GO'; now: number }
  /** `index`: the clip the gesture was made on; ignored if the round has moved past it. */
  | { type: 'MARK_AI'; now: number; index?: number }
  | { type: 'SKIP'; now: number; index?: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'QUIT'; now: number }
  /** More clips for the untimed game's deck. */
  | { type: 'DEAL'; cards: readonly Card[] };

export function createRound(deck: readonly Card[], durationMs: number = GAME.roundMs, timed = true): RoundState {
  return {
    timed,
    startedAt: null,
    phase: 'ready',
    deck,
    index: 0,
    guesses: [],
    durationMs,
    deadline: null,
    remainingMs: durationMs,
    countdownEnd: null,
    endReason: null,
  };
}

/** Play time left at `now`. */
export function remaining(s: RoundState, now: number): number {
  if (!s.timed) return Infinity;
  if (s.phase === 'playing' && s.deadline !== null) return Math.max(0, s.deadline - now);
  return s.remainingMs;
}

/** How far the countdown has run at `now`, 0..1 (1 outside a countdown). */
export function countdownProgress(s: RoundState, now: number, countdownMs: number = GAME.countdownMs): number {
  if (s.phase !== 'countdown' || s.countdownEnd === null) return 1;
  return Math.min(1, Math.max(0, 1 - (s.countdownEnd - now) / countdownMs));
}

/** Play time used so far, ms. */
export function elapsed(s: RoundState, now: number): number {
  return s.durationMs - remaining(s, now);
}

function end(s: RoundState, reason: EndReason, remainingMs: number): RoundState {
  return { ...s, phase: 'over', endReason: reason, deadline: null, countdownEnd: null, remainingMs };
}

function judge(s: RoundState, guess: Verdict, now: number, index: number | undefined): RoundState {
  if (s.phase !== 'playing') return s;
  // A second gesture on the same clip (a swipe racing an auto-advance) does nothing.
  if (index !== undefined && index !== s.index) return s;
  if (!s.timed) {
    // Untimed: judged at its own pace; the deck grows as it's dealt, so running out only waits.
    const card = s.deck[s.index];
    if (!card) return s;
    const g: Guess = { clipId: card.id, guess, truth: card.truth, correct: guess === card.truth, at: now - (s.startedAt ?? now) };
    return { ...s, guesses: [...s.guesses, g], index: s.index + 1 };
  }
  const left = remaining(s, now);
  // The clip on screen when time ran out isn't judged.
  if (left <= 0) return end(s, 'time', 0);
  const card = s.deck[s.index];
  if (!card) return end(s, 'deck', left);
  const g: Guess = { clipId: card.id, guess, truth: card.truth, correct: guess === card.truth, at: s.durationMs - left };
  const next: RoundState = { ...s, guesses: [...s.guesses, g], index: s.index + 1 };
  return next.index >= s.deck.length ? end(next, 'deck', left) : next;
}

function go(s: RoundState, now: number): RoundState {
  if (s.deck.length === 0) return end(s, 'deck', s.remainingMs);
  return { ...s, phase: 'playing', deadline: now + s.remainingMs, countdownEnd: null, startedAt: s.startedAt ?? now };
}

export function roundReducer(s: RoundState, e: RoundEvent): RoundState {
  switch (e.type) {
    case 'START':
      if (s.phase !== 'ready') return s;
      // Untimed: straight into play, no countdown and no clock.
      if (!s.timed) return { ...s, phase: 'playing', startedAt: e.now };
      return { ...s, phase: 'countdown', countdownEnd: e.now + GAME.countdownMs };
    case 'GO':
      return s.phase === 'countdown' ? go(s, e.now) : s;
    case 'MARK_AI':
      return judge(s, 'ai', e.now, e.index);
    case 'SKIP':
      return judge(s, 'real', e.now, e.index);
    case 'PAUSE':
      // Untimed: nothing runs out, so there's nothing to hold.
      if (!s.timed) return s;
      if (s.phase === 'playing') {
        const left = remaining(s, e.now);
        if (left <= 0) return end(s, 'time', 0);
        return { ...s, phase: 'paused', deadline: null, remainingMs: left };
      }
      // Paused mid-countdown: the countdown starts over on resume.
      if (s.phase === 'countdown') return { ...s, phase: 'paused', countdownEnd: null };
      return s;
    case 'RESUME':
      if (s.phase !== 'paused') return s;
      return { ...s, phase: 'countdown', countdownEnd: e.now + GAME.countdownMs };
    case 'TICK':
      if (!s.timed) return s;
      if (s.phase === 'countdown' && s.countdownEnd !== null && e.now >= s.countdownEnd) return go(s, s.countdownEnd);
      if (s.phase === 'playing' && remaining(s, e.now) <= 0) return end(s, 'time', 0);
      return s;
    case 'QUIT':
      if (s.phase === 'over') return s;
      return end(s, 'quit', s.timed ? remaining(s, e.now) : 0);
    case 'DEAL':
      if (s.phase === 'over' || !e.cards.length) return s;
      return { ...s, deck: [...s.deck, ...e.cards] };
  }
}
