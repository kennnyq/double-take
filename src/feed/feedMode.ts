/**
 * What each feed mode (see settings) does to the feed. Pure, so it runs under
 * `node --test`.
 *
 * - default: no label; the reveal (the tells walkthrough) shows the verdict and the reasoning.
 * - autoLabel: every clip with a known verdict shows "AI" / "Not AI"; the reveal adds the reasoning.
 * - onlyAi / onlyReal: the feed keeps only clips with that verdict. Unknown clips
 *   (the bundled placeholders) are left out, so these feeds end instead of
 *   running on forever.
 */
import type { Clip, Verdict } from '../data/clips.ts';
import type { FeedMode } from '../settings/settings.ts';
import { clipIndex } from '../social/clipRefs.ts';

/** The verdict a feed mode keeps, or null when it keeps everything. */
export function modeFilter(mode: FeedMode): Verdict | null {
  return mode === 'onlyAi' ? 'ai' : mode === 'onlyReal' ? 'real' : null;
}

/** The clips a mode shows. Returns `clips` itself when nothing is filtered. */
export function clipsForMode(clips: Clip[], mode: FeedMode): Clip[] {
  const keep = modeFilter(mode);
  return keep ? clips.filter((c) => c.verdict === keep) : clips;
}

/** The label shown on the clip at all times, or null. */
export function autoLabel(clip: Pick<Clip, 'verdict'>, mode: FeedMode): Verdict | null {
  return mode === 'autoLabel' ? (clip.verdict ?? null) : null;
}

export const VERDICT_TEXT: Record<Verdict, string> = { ai: 'AI', real: 'Not AI' };

/**
 * Where a feed index (`clip-<n>`, as profile tiles and the landing use) lands in
 * a filtered feed: that clip, or the next one shown after it, or the last one.
 * (Unfiltered feeds use the index as is.)
 */
export function shownIndexOf(shown: Clip[], feedIndex: number): number {
  if (!shown.length) return 0;
  const i = shown.findIndex((c) => clipIndex(c.id) >= feedIndex);
  return i >= 0 ? i : shown.length - 1;
}

/**
 * The index to stay on when the shown list changes (a mode switch): the same
 * clip if it's still shown, else the nearest one after it.
 */
export function keepPosition(prev: Clip[], next: Clip[], active: number): number {
  const current = prev[active];
  if (!current || !next.length) return 0;
  const same = next.findIndex((c) => c.id === current.id);
  return same >= 0 ? same : shownIndexOf(next, clipIndex(current.id));
}

/** True when `next` only appended to `prev` (more placeholders), so positions still hold. */
export function isAppend(prev: Clip[], next: Clip[]): boolean {
  if (next.length < prev.length) return false;
  for (let i = 0; i < prev.length; i++) if (prev[i].id !== next[i].id) return false;
  return true;
}
