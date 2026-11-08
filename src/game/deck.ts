/**
 * The round's deck: an even shuffle of AI and real clips, whatever the feed
 * mode, preferring clips the last rounds didn't use. Pure, with an injectable
 * random source so tests can seed it.
 */
import { GAME } from './config.ts';
import type { Card, Verdict } from './round.ts';

/** What the deck needs from a clip. */
export interface DeckSource {
  id: string;
  /** Stable across sessions (the Worker's id); `id` is the feed position. */
  sourceId?: string;
  verdict?: Verdict;
  /** Width / height; unknown counts as portrait (the 9:16 placeholders). */
  aspect?: number;
}

export interface DeckOptions {
  /** 0 ≤ rng() < 1. */
  rng?: () => number;
  /** Clip keys (`clipKey`) used by recent rounds: dealt only once fresh ones run out. */
  recent?: Iterable<string>;
  cap?: number;
}

/** The key a clip is remembered by between rounds. */
export function clipKey(c: Pick<DeckSource, 'id' | 'sourceId'>): string {
  return c.sourceId ?? c.id;
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Taller than wide: fills a phone screen the way the round is meant to be played. */
export function isPortrait(c: Pick<DeckSource, 'aspect'>): boolean {
  return c.aspect === undefined || c.aspect < 1;
}

/**
 * The order clips of one kind are dealt in: portrait before landscape (a
 * landscape clip only when there aren't enough portrait ones), and within
 * each, clips the last rounds didn't use first. Each group is shuffled.
 */
function dealOrder<T extends DeckSource>(clips: readonly T[], recent: Set<string>, rng: () => number): T[] {
  const group = (portrait: boolean, used: boolean) =>
    shuffle(
      clips.filter((c) => isPortrait(c) === portrait && recent.has(clipKey(c)) === used),
      rng,
    );
  return [...group(true, false), ...group(true, true), ...group(false, false), ...group(false, true)];
}

/** How many clips of each kind there are (placeholders have no verdict and don't count). */
export function kindCounts(clips: readonly DeckSource[]): Record<Verdict, number> {
  const n = { ai: 0, real: 0 };
  for (const c of clips) if (c.verdict) n[c.verdict]++;
  return n;
}

/** Whether a production build offers the round: enough clips of both kinds. */
export function deckPlayable(clips: readonly DeckSource[], minPerKind: number = GAME.minPerKind): boolean {
  const n = kindCounts(clips);
  return n.ai >= minPerKind && n.real >= minPerKind;
}

/**
 * Half AI, half real, up to `cap`, shuffled together. With no clips of one
 * kind at all (a dev feed), it deals what there is rather than nothing.
 */
export function buildDeck<T extends DeckSource>(clips: readonly T[], opts: DeckOptions = {}): (Card & { clip: T })[] {
  const rng = opts.rng ?? Math.random;
  const cap = Math.max(0, opts.cap ?? GAME.deckCap);
  const recent = new Set(opts.recent ?? []);
  // One entry per clip, even if the feed repeats one.
  const seen = new Set<string>();
  const unique = clips.filter((c) => {
    if (!c.verdict || seen.has(clipKey(c))) return false;
    seen.add(clipKey(c));
    return true;
  });
  const ai = dealOrder(
    unique.filter((c) => c.verdict === 'ai'),
    recent,
    rng,
  );
  const real = dealOrder(
    unique.filter((c) => c.verdict === 'real'),
    recent,
    rng,
  );
  const perKind = Math.min(Math.floor(cap / 2), ai.length, real.length);
  const picked = perKind > 0 ? [...ai.slice(0, perKind), ...real.slice(0, perKind)] : [...ai, ...real].slice(0, cap);
  return shuffle(picked, rng).map((clip) => ({ id: clip.id, truth: clip.verdict!, clip }));
}

/** A small seeded generator (mulberry32) for tests and repeatable dev rounds. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
