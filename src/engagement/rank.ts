/**
 * A proof of concept of a For You ranker: orders the feed from what this
 * device has seen the viewer do, with every score explained. Small and
 * local on purpose: no server, a handful of signals and features, and an
 * exploration share so new kinds of clips keep getting a chance. With a real
 * catalog the same shape scales: the signals become server-side counters,
 * the features embeddings, and the affinity a learned model.
 *
 *   score = affinity (what you engaged with, by feature)
 *         + novelty (not seen yet) − fatigue (seen recently, decaying)
 *         + a little popularity
 *   and every EXPLORE_EVERY-th slot goes to a random clip.
 *
 * Pure, for `node --test`.
 */
import { seededRng } from '../game/deck.ts';

/** What the viewer did with one clip, on this device. */
export interface ClipSignals {
  views: number;
  /** Sum of the fraction watched on each view (0..1 each). */
  watched: number;
  completions: number;
  replays: number;
  likes: number;
  saves: number;
  shares: number;
  /** Double takes opened. */
  doubleTakes: number;
  /** Scrolled past within the first moments. */
  skips: number;
  /** Timed round answers: a miss means it fooled you (interesting), a hit that it didn't. */
  missed: number;
  caught: number;
  /** ms since epoch. */
  lastSeen: number;
}

export const NO_SIGNALS: Readonly<ClipSignals> = Object.freeze({
  views: 0,
  watched: 0,
  completions: 0,
  replays: 0,
  likes: 0,
  saves: 0,
  shares: 0,
  doubleTakes: 0,
  skips: 0,
  missed: 0,
  caught: 0,
  lastSeen: 0,
});

/** How much each signal says "more like this" (negative: "less"). */
export const SIGNAL_WEIGHTS = {
  likes: 3,
  saves: 3,
  shares: 2,
  doubleTakes: 1.5,
  completions: 1,
  replays: 0.8,
  missed: 0.6,
  caught: 0.2,
  skips: -1.2,
} as const;

/** One clip's engagement: the weighted sum of what was done with it. */
export function engagement(s: ClipSignals): number {
  let e = 0;
  for (const [k, w] of Object.entries(SIGNAL_WEIGHTS)) e += w * (s[k as keyof typeof SIGNAL_WEIGHTS] ?? 0);
  return e;
}

/** What the ranker knows about a clip's content: a few named features (e.g. `verdict:ai`, `cat:subject`, `author:x`). */
export type Features = readonly string[];

export interface RankInput {
  key: string;
  features: Features;
  /** Platform likes, for a little popularity. */
  likes: number;
}

export interface Ranked<C> {
  clip: C;
  score: number;
  /** Why, in the readout's words, largest first. */
  reasons: { why: string; value: number }[];
  explored: boolean;
}

export interface RankOptions {
  now: number;
  seed?: number;
  /** Every n-th slot is a random clip (0: none). */
  exploreEvery?: number;
  /** How readable a feature is, for reasons (e.g. `cat:subject` → "Bodies"). */
  label?: (feature: string) => string;
}

export const EXPLORE_EVERY = 5;
const NOVELTY = 0.6;
const FATIGUE = 0.5;
/** Fatigue halves every this many ms. */
const FATIGUE_HALF_LIFE = 24 * 3600 * 1000;
const POPULARITY = 0.08;
/** Affinity for a feature shrinks toward 0 until a few clips with it have been seen. */
const AFFINITY_PRIOR = 2;

/**
 * Per feature: the engagement of clips with it, averaged over the clips with
 * it that were seen (shrunk toward 0 for features seen only once or twice).
 */
export function affinities(items: readonly RankInput[], signals: (key: string) => ClipSignals): Map<string, number> {
  const sum = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const it of items) {
    const s = signals(it.key);
    if (!s.views && !engagement(s)) continue;
    const e = engagement(s);
    for (const f of it.features) {
      sum.set(f, (sum.get(f) ?? 0) + e);
      seen.set(f, (seen.get(f) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  for (const [f, e] of sum) out.set(f, e / (AFFINITY_PRIOR + (seen.get(f) ?? 0)));
  return out;
}

export function scoreClip(it: RankInput, s: ClipSignals, aff: Map<string, number>, o: RankOptions): { score: number; reasons: { why: string; value: number }[] } {
  const reasons: { why: string; value: number }[] = [];
  const label = o.label ?? ((f: string) => f);
  for (const f of it.features) {
    const a = aff.get(f);
    if (a) reasons.push({ why: a > 0 ? `you engage with ${label(f)}` : `you skip ${label(f)}`, value: a / Math.max(1, it.features.length / 2) });
  }
  if (!s.views) reasons.push({ why: 'new to you', value: NOVELTY });
  else {
    const decay = Math.pow(0.5, Math.max(0, o.now - s.lastSeen) / FATIGUE_HALF_LIFE);
    reasons.push({ why: `seen ${s.views}×`, value: -FATIGUE * s.views * decay });
  }
  if (it.likes > 0) reasons.push({ why: 'popular', value: POPULARITY * Math.log10(1 + it.likes) });
  reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { score: reasons.reduce((n, r) => n + r.value, 0), reasons };
}

/** The feed in ranked order, every `exploreEvery`-th slot a random pick from what's left. */
export function rankFeed<C>(clips: readonly C[], input: (c: C) => RankInput, signals: (key: string) => ClipSignals, o: RankOptions): Ranked<C>[] {
  const items = clips.map((c) => ({ clip: c, it: input(c) }));
  const aff = affinities(
    items.map((x) => x.it),
    signals,
  );
  const scored = items
    .map(({ clip, it }) => ({ clip, ...scoreClip(it, signals(it.key), aff, o), explored: false }))
    .sort((a, b) => b.score - a.score);
  const every = o.exploreEvery ?? EXPLORE_EVERY;
  if (!every) return scored;
  const rng = seededRng(o.seed ?? 1);
  const out: Ranked<C>[] = [];
  const rest = [...scored];
  while (rest.length) {
    const explore = every > 0 && (out.length + 1) % every === 0 && rest.length > 1;
    // Explore among the lower half, so it surfaces what the ranker would otherwise bury.
    const i = explore ? Math.floor(rest.length / 2 + rng() * Math.ceil(rest.length / 2)) : 0;
    const [pick] = rest.splice(Math.min(i, rest.length - 1), 1);
    out.push(explore ? { ...pick, explored: true, reasons: [{ why: 'exploring', value: 0 }, ...pick.reasons] } : pick);
  }
  return out;
}

/** Folds one event into a clip's signals. */
export type SignalEvent =
  | { kind: 'view'; watched: number }
  | { kind: 'replay' | 'like' | 'save' | 'share' | 'doubleTake' | 'skip' }
  | { kind: 'answer'; correct: boolean };

export function addEvent(s: ClipSignals, e: SignalEvent, now: number): ClipSignals {
  const n = { ...s, lastSeen: now };
  switch (e.kind) {
    case 'view':
      n.views++;
      n.watched += Math.min(1, Math.max(0, e.watched));
      if (e.watched >= 0.9) n.completions++;
      return n;
    case 'replay':
      n.replays++;
      return n;
    case 'like':
      n.likes++;
      return n;
    case 'save':
      n.saves++;
      return n;
    case 'share':
      n.shares++;
      return n;
    case 'doubleTake':
      n.doubleTakes++;
      return n;
    case 'skip':
      n.skips++;
      return n;
    case 'answer':
      if (e.correct) n.caught++;
      else n.missed++;
      return n;
  }
}
