/** Shared demo quality policy for Home, Game and landing. Pure; no media requests. */
import { DEMO_TELLS } from './demoQuality.ts';

export interface RankableClip {
  id: string;
  sourceId?: string;
  verdict?: 'ai' | 'real';
  aspect?: number;
  duration?: number;
  tellsUrl?: string;
  verdictChecked?: boolean;
  sourceLikes?: number;
  verdictTier?: string;
}
export interface TellSummary {
  path: string;
  total: number;
  boxed: number;
  visual: number;
  reviewed: number;
}

/** Kenny's explicit overrides, in order. Unknown/duplicate ids are ignored.
 * Overrides deliberately take priority over quality AND the real/AI interleave.
 */
export const DEMO_PINNED_FIRST: readonly string[] = ['x-1996831827357847987'];
/** Demo editorial preferences; retain these clips below the opening candidates. */
const DEMO_SCORE_ADJUSTMENTS: Readonly<Record<string, number>> = {
  'x-2082309674960032067': -48, // Kenny's opera-glove cat preference.
  'x-2106432142217765020': -48, // Bathroom/trans-topic burned-in caption.
  'x-1902265979444375861': -48, // Burned-in claim that the Crew-9 rescue is fake.
};
/** Stable for this app session; callers/tests can supply a seed for replay. */
export const DEMO_SESSION_SEED = Math.floor(Math.random() * 0xffffffff);
export const QUALITY_TIER_WIDTH = 12;

export function tellSummary(clip: RankableClip): TellSummary | undefined {
  const summary = (DEMO_TELLS as Record<string, TellSummary>)[clip.sourceId ?? ''];
  if (!summary || !clip.tellsUrl) return undefined;
  // Don't silently score an old model/review revision as if it were current.
  try {
    const path = decodeURIComponent(new URL(clip.tellsUrl, 'https://local/').pathname).replace(/^\/+/, '').replace(/^m\//, '');
    return path === summary.path ? summary : undefined;
  } catch {
    return undefined;
  }
}

/** Points are quality hints, not a claim that an unreviewed model tell is true. */
export function scoreClip(clip: RankableClip, summary = tellSummary(clip)): number {
  if (!clip.sourceId || !clip.verdict) return -100;
  const aspect = clip.aspect ?? 1;
  let score = aspect > 0 && aspect <= 1 / 1.6 ? 36 : aspect < 1 ? 12 : 0;
  const d = clip.duration;
  if (d && Number.isFinite(d)) {
    score += d >= 8 && d <= 20 ? 20 : d > 40 ? -35 : d <= 8 ? 10 : d <= 30 ? 8 : 0;
  }
  if (clip.verdict === 'ai') {
    if (summary) {
      score += 10 * Math.min(summary.boxed, 5) - 2 * Math.max(0, summary.boxed - 5);
      if (summary.boxed >= 3 && summary.boxed <= 5) score += 10;
      score += 10 * summary.visual / Math.max(1, summary.total);
      score += 14 * summary.reviewed / Math.max(1, summary.total);
    }
    if (clip.verdictChecked) score += 8;
  } else {
    // Real source engagement only, never the synthetic rail counts. A small
    // popularity proxy; aspect and length matter much more than viral reach.
    score += Math.min(8, Math.log10(1 + Math.max(0, clip.sourceLikes ?? 0)) * 2);
    if (['real-verified', 'real-prior', 'real-agency'].includes(clip.verdictTier ?? '')) score += 8;
  }
  return Math.round((score + (DEMO_SCORE_ADJUSTMENTS[clip.sourceId] ?? 0)) * 10) / 10;
}

function noise(seed: number, key: string): number {
  let h = seed >>> 0;
  for (const char of key) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

export interface RankOptions {
  seed?: number;
  pinnedFirst?: readonly string[];
  order?: 'best' | 'original';
}

/** Preserve objects/ids. Only the shared feed loader renumbers positional ids.
 * Quality tiers descend within each verdict; seeded shuffling stays in a tier.
 * One or two AI clips then a real clip, until one pool runs out. Pins come first.
 */
export function rankClips<T extends RankableClip>(clips: readonly T[], options: RankOptions = {}): T[] {
  if (options.order === 'original') return [...clips];
  const seed = options.seed ?? DEMO_SESSION_SEED;
  const pins = options.pinnedFirst ?? DEMO_PINNED_FIRST;
  const pinned = [...new Set(pins)].flatMap((id) => {
    const clip = clips.find((c) => c.sourceId === id);
    return clip ? [clip] : [];
  });
  const pinnedIds = new Set(pinned.map((c) => c.sourceId));
  const rest = clips.filter((c) => !pinnedIds.has(c.sourceId));
  const sorted = (verdict: 'ai' | 'real') => rest.filter((c) => c.sourceId && c.verdict === verdict)
    .map((clip) => ({ clip, tier: Math.floor(scoreClip(clip) / QUALITY_TIER_WIDTH), noise: noise(seed, clip.sourceId!) }))
    .sort((a, b) => b.tier - a.tier || a.noise - b.noise || a.clip.sourceId!.localeCompare(b.clip.sourceId!))
    .map(({ clip }) => clip);
  const ai = sorted('ai');
  const real = sorted('real');
  const out = [...pinned];
  let a = 0, r = 0, run = 0;
  for (const clip of pinned) run = clip.verdict === 'ai' ? run + 1 : 0;
  while (a < ai.length || r < real.length) {
    const chooseReal = r < real.length && (a === ai.length || run >= 2 || (run === 1 && noise(seed, `mix:${out.length}`) > 0.7));
    out.push(chooseReal ? real[r++] : ai[a++]);
    run = chooseReal ? 0 : run + 1;
  }
  return [...out, ...rest.filter((c) => !c.sourceId || !c.verdict)];
}

/** Landing's shortlist: prefer one tier-width of the best of each verdict,
 * then fill to `minimum` distinct clips (12 by default) for a varied hero wall.
 * Call after filtering for available atlas cells or AI walkthroughs, if needed.
 * Always honors pins. Falls back gracefully for offline/unknown-only feeds.
 */
export function heroCandidates<T extends RankableClip>(clips: readonly T[], limit = 48, options: RankOptions & { minimum?: number } = {}): T[] {
  const seen = new Set<string>();
  const ranked = rankClips(clips, { ...options, order: 'best' }).filter((c) => {
    const key = c.sourceId ?? c.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const best = { ai: -Infinity, real: -Infinity };
  for (const c of ranked) if (c.verdict) best[c.verdict] = Math.max(best[c.verdict], scoreClip(c));
  const pins = new Set(options.pinnedFirst ?? DEMO_PINNED_FIRST);
  const top = ranked.filter((c) => pins.has(c.sourceId ?? '') || (c.verdict && scoreClip(c) >= best[c.verdict] - QUALITY_TIER_WIDTH));
  const selected = new Set(top);
  const minimum = Math.min(limit, options.minimum ?? 12);
  for (const c of ranked) {
    if (top.length >= minimum) break;
    if (!selected.has(c)) { top.push(c); selected.add(c); }
  }
  return (top.length ? top : ranked).slice(0, Math.max(0, limit));
}
