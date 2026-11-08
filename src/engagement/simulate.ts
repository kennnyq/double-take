/**
 * A simulated viewer for the ranker, for the game lab and the tests: they
 * like some features and skip others; each session the ranker orders the
 * catalog from what they did before, they watch the top of it, and the
 * share of clips they enjoy near the top (precision@k) is measured against
 * a random order's. Pure, for `node --test`.
 */
import { seededRng, shuffle } from '../game/deck.ts';
import { NO_SIGNALS, addEvent, rankFeed, type ClipSignals, type RankInput, type Ranked } from './rank.ts';

export interface ViewerSim {
  /** How much they like each feature (positive) or dislike it (negative); the rest are neutral. */
  taste: Record<string, number>;
  sessions: number;
  /** Clips watched per session (from the top). */
  perSession: number;
  /** Top-k measured. */
  k?: number;
  seed?: number;
  exploreEvery?: number;
}

export interface SessionResult {
  session: number;
  /** Share of the top k (by rank) the viewer enjoys. */
  precision: number;
  /** The same for a random order of the catalog. */
  baseline: number;
}

/** Whether the viewer enjoys a clip: the sum of their taste for its features is above 0. */
export const enjoys = (taste: Record<string, number>, it: RankInput) => it.features.reduce((n, f) => n + (taste[f] ?? 0), 0) > 0;

export function simulateViewer(items: readonly RankInput[], o: ViewerSim): { sessions: SessionResult[]; last: Ranked<RankInput>[] } {
  const rng = seededRng(o.seed ?? 9);
  const k = o.k ?? 10;
  const sig = new Map<string, ClipSignals>();
  const get = (key: string) => sig.get(key) ?? NO_SIGNALS;
  const out: SessionResult[] = [];
  let last: Ranked<RankInput>[] = [];
  let now = 1_700_000_000_000;
  for (let s = 0; s < o.sessions; s++) {
    last = rankFeed(items, (x) => x, get, { now, seed: s + 1, exploreEvery: o.exploreEvery });
    const top = last.slice(0, k);
    const random = shuffle(items, rng).slice(0, k);
    out.push({
      session: s + 1,
      precision: top.filter((r) => enjoys(o.taste, r.clip)).length / Math.max(1, top.length),
      baseline: random.filter((it) => enjoys(o.taste, it)).length / Math.max(1, random.length),
    });
    // They watch the top of the feed: enjoyed clips are watched through and often liked; others skipped.
    for (const r of last.slice(0, o.perSession)) {
      const key = r.clip.key;
      const like = enjoys(o.taste, r.clip);
      let next = addEvent(get(key), { kind: 'view', watched: like ? 0.95 : 0.1 }, now);
      if (like && rng() < 0.6) next = addEvent(next, { kind: 'like' }, now);
      if (!like) next = addEvent(next, { kind: 'skip' }, now);
      sig.set(key, next);
    }
    now += 24 * 3600 * 1000;
  }
  return { sessions: out, last };
}
