/**
 * Fake finished rounds for the game lab: any number of clips, any share of
 * right answers and of AI clips, without playing. Pure, for `node --test`.
 */
import { seededRng, shuffle } from '../deck.ts';
import { createRound, type Card, type Guess, type RoundState, type Verdict } from '../round.ts';
import { roundStats, type RoundStats } from '../score.ts';

export interface FakeOptions {
  /** Clips judged. */
  judged: number;
  /** 0..1 of the judged clips answered right. */
  right: number;
  /** 0..1 of the clips that are AI. */
  ai: number;
  /** Time ran out on one more clip (shown as not judged). */
  timeUp: boolean;
  seed?: number;
}

export interface FakeRound<C> {
  round: RoundState;
  stats: RoundStats;
  clips: Map<string, C>;
}

/**
 * A round over `pool` (repeating it if it's short) with exactly the asked
 * shares, spread through the round rather than bunched.
 */
export function fakeRound<C extends { id: string }>(pool: readonly C[], o: FakeOptions): FakeRound<C> {
  const n = Math.max(0, Math.floor(o.judged));
  const total = n + (o.timeUp ? 1 : 0);
  const rng = seededRng(o.seed ?? 1);
  const aiCount = Math.round(total * Math.min(1, Math.max(0, o.ai)));
  const rightCount = Math.round(n * Math.min(1, Math.max(0, o.right)));
  const truths = shuffle(
    Array.from({ length: total }, (_, i): Verdict => (i < aiCount ? 'ai' : 'real')),
    rng,
  );
  const rights = new Set(shuffle([...Array(n).keys()], rng).slice(0, rightCount));
  const clips = new Map<string, C>();
  const deck: Card[] = [];
  for (let i = 0; i < total; i++) {
    const base = pool.length ? pool[i % pool.length] : ({ id: `fake-${i}` } as C);
    const id = `lab-${i}`;
    clips.set(id, { ...base, id });
    deck.push({ id, truth: truths[i] });
  }
  const guesses: Guess[] = deck.slice(0, n).map((card, i) => {
    const correct = rights.has(i);
    const guess: Verdict = correct ? card.truth : card.truth === 'ai' ? 'real' : 'ai';
    return { clipId: card.id, guess, truth: card.truth, correct, at: i * 1500 };
  });
  const round: RoundState = {
    ...createRound(deck, 60_000),
    phase: 'over',
    index: n,
    guesses,
    remainingMs: o.timeUp ? 0 : 12_000,
    endReason: o.timeUp ? 'time' : 'deck',
  };
  return { round, stats: roundStats(guesses), clips };
}
