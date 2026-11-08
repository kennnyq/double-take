import type { Clip } from '@/data/clips';
import { gameDev } from '@/game/devOptions';
import { CATEGORY_INFO, type SkillCategory } from '@/skills/categories';
import { skillStore } from '@/skills/store';
import { clipKey } from '@/social/clipRefs';
import { rankFeed, type Ranked, type RankInput } from './rank';
import { signals } from './store';

/** A clip's content features for the ranker: what it is, whose, what shape, what kind of giveaway. */
export function features(clip: Clip): string[] {
  const f = [`verdict:${clip.verdict ?? 'unknown'}`, `author:${clip.author}`, `shape:${!clip.aspect || clip.aspect < 1 ? 'portrait' : 'landscape'}`];
  if (clip.verdictTier) f.push(`tier:${clip.verdictTier}`);
  const cats = skillStore.getSnapshot().cats[clipKey(clip)];
  for (const c of Object.keys(cats ?? {})) f.push(`cat:${c}`);
  return f;
}

/** Features in the readout's words. */
export function featureLabel(f: string): string {
  const [kind, v] = f.split(':');
  if (kind === 'cat') return `${CATEGORY_INFO[v as SkillCategory]?.label ?? v} clips`;
  if (kind === 'verdict') return v === 'ai' ? 'AI clips' : 'real clips';
  if (kind === 'author') return `@${v}`;
  if (kind === 'shape') return `${v} clips`;
  if (kind === 'tier') return v.replace('real-', '') + ' real clips';
  return f;
}

let last: Ranked<Clip>[] = [];
const listeners = new Set<() => void>();

/** The last ranking, for the dev readout ("why this clip"). */
export const lastRanking = {
  get: () => last,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/**
 * The feed's order. Off (the default): unchanged. On (Dev settings → Game →
 * Feed ranker): remote clips ranked for this viewer, the bundled placeholders
 * after them, and each clip's positional id renumbered to its new place.
 */
export function orderFeed(clips: Clip[]): Clip[] {
  if (!gameDev.getSnapshot().rankFeed) return clips;
  const remote = clips.filter((c) => c.sourceId);
  const rest = clips.filter((c) => !c.sourceId);
  const input = (c: Clip): RankInput => ({ key: clipKey(c), features: features(c), likes: c.likes });
  last = rankFeed(remote, input, signals.get, { now: Date.now(), seed: Math.floor(Date.now() / 3.6e6), label: featureLabel });
  listeners.forEach((l) => l());
  return [...last.map((r) => r.clip), ...rest].map((c, i) => ({ ...c, id: `clip-${i}` }));
}
