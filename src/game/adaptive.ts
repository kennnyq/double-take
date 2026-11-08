/**
 * Adaptive dealing (IRT-lite): instead of a plain shuffle, deal clips the
 * player should get right about two times in three: hard enough to learn
 * from, easy enough to stay fun. Still half AI and half real, so neither
 * always-skip nor always-mark pays; a share of picks ignore the target, to
 * keep measuring every difficulty (exploration). Pure, for `node --test`.
 */
import { pCorrect, skillForClip, type Skills } from '../skills/skill.ts';
import type { SkillCategory } from '../skills/categories.ts';
import { clipKey, isPortrait, shuffle, type DeckSource } from './deck.ts';
import { GAME } from './config.ts';
import type { Card } from './round.ts';

export interface AdaptiveSource extends DeckSource {
  cats: Partial<Record<SkillCategory, number>>;
  /** Current difficulty estimate (mean). */
  difficulty: number;
}

export interface AdaptiveOptions {
  skills: Skills;
  rng?: () => number;
  recent?: Iterable<string>;
  cap?: number;
  /** The success rate to aim each clip at. */
  target?: number;
  /** How far from the target a clip may be and still be likely (in success probability). */
  spread?: number;
  /** Share of picks made uniformly at random. */
  explore?: number;
}

export const ADAPTIVE_TARGET = 0.65;

/** How much a clip suits the player: a bell around the target, less for recent or landscape clips. */
export function suitability(p: number, o: { target: number; spread: number; recent: boolean; portrait: boolean }): number {
  const fit = Math.exp(-((p - o.target) ** 2) / (2 * o.spread ** 2));
  return fit * (o.recent ? 0.2 : 1) * (o.portrait ? 1 : 0.35);
}

/** Draws `k` items without replacement, each pick weighted, or (with probability `explore`) uniform. */
export function weightedPick<T>(items: readonly T[], weight: (t: T) => number, k: number, rng: () => number, explore: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < k && pool.length) {
    let i: number;
    if (rng() < explore) i = Math.floor(rng() * pool.length);
    else {
      const ws = pool.map(weight);
      const total = ws.reduce((a, b) => a + b, 0);
      if (total <= 0) i = Math.floor(rng() * pool.length);
      else {
        let r = rng() * total;
        i = 0;
        while (i < ws.length - 1 && r >= ws[i]) r -= ws[i++];
      }
    }
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

export function buildAdaptiveDeck<T extends AdaptiveSource>(clips: readonly T[], o: AdaptiveOptions): (Card & { clip: T; p: number })[] {
  const rng = o.rng ?? Math.random;
  const cap = Math.max(0, o.cap ?? GAME.deckCap);
  const recent = new Set(o.recent ?? []);
  const target = o.target ?? ADAPTIVE_TARGET;
  const spread = o.spread ?? 0.12;
  const explore = o.explore ?? 0.15;
  const seen = new Set<string>();
  const unique = clips.filter((c) => {
    if (!c.verdict || seen.has(clipKey(c))) return false;
    seen.add(clipKey(c));
    return true;
  });
  const pOf = (c: T) => pCorrect(skillForClip(o.skills, c.cats), c.difficulty);
  const weight = (c: T) => suitability(pOf(c), { target, spread, recent: recent.has(clipKey(c)), portrait: isPortrait(c) });
  const ai = unique.filter((c) => c.verdict === 'ai');
  const real = unique.filter((c) => c.verdict === 'real');
  const perKind = Math.min(Math.floor(cap / 2), ai.length, real.length);
  const picked =
    perKind > 0
      ? [...weightedPick(ai, weight, perKind, rng, explore), ...weightedPick(real, weight, perKind, rng, explore)]
      : weightedPick(unique, weight, Math.min(cap, unique.length), rng, explore);
  return shuffle(picked, rng).map((clip) => ({ id: clip.id, truth: clip.verdict!, clip, p: pOf(clip) }));
}
