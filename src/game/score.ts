/**
 * A round's score and stats from its guesses. Pure, for `node --test`.
 * The rules are in `config.ts` (POINTS).
 */
import { POINTS } from './config.ts';
import type { Guess } from './round.ts';

export interface RoundStats {
  score: number;
  /** Decisions made (clips marked or skipped). */
  judged: number;
  /** AI clips marked AI. */
  hits: number;
  /** AI clips judged, marked or skipped. */
  aiSeen: number;
  /** Real clips marked AI. */
  falseAlarms: number;
  /** Real clips skipped. */
  correctSkips: number;
  /** AI clips skipped. */
  misses: number;
  /** Correct decisions ÷ decisions, 0..1 (0 for an empty round). */
  accuracy: number;
  bestStreak: number;
}

export function pointsFor(g: Pick<Guess, 'guess' | 'truth'>): number {
  if (g.guess === 'ai') return g.truth === 'ai' ? POINTS.hit : POINTS.falseAlarm;
  return g.truth === 'real' ? POINTS.correctSkip : POINTS.miss;
}

export function scoreRound(guesses: readonly Guess[]): number {
  const raw = guesses.reduce((n, g) => n + pointsFor(g), 0);
  return Math.max(POINTS.floor, raw);
}

export function bestStreak(guesses: readonly Guess[]): number {
  let best = 0;
  let run = 0;
  for (const g of guesses) {
    run = g.correct ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export function roundStats(guesses: readonly Guess[]): RoundStats {
  let hits = 0;
  let aiSeen = 0;
  let falseAlarms = 0;
  let correctSkips = 0;
  let misses = 0;
  for (const g of guesses) {
    if (g.truth === 'ai') aiSeen++;
    if (g.guess === 'ai' && g.truth === 'ai') hits++;
    else if (g.guess === 'ai') falseAlarms++;
    else if (g.truth === 'real') correctSkips++;
    else misses++;
  }
  const judged = guesses.length;
  return {
    score: scoreRound(guesses),
    judged,
    hits,
    aiSeen,
    falseAlarms,
    correctSkips,
    misses,
    accuracy: judged ? (hits + correctSkips) / judged : 0,
    bestStreak: bestStreak(guesses),
  };
}

/** The guesses that were wrong, in the order they were made: the results gallery. */
export function wrongGuesses(guesses: readonly Guess[]): Guess[] {
  return guesses.filter((g) => !g.correct);
}
