import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { media } from './media';

let playable: Promise<Clip[]> | null = null;

/**
 * The feed's clips that can be dealt: a verdict, and media that actually
 * loads (checked once per session; see `media.ts`). Clips that fail are left
 * out of every round, so a round never shows a black card.
 */
export function loadPlayableClips(): Promise<Clip[]> {
  playable ??= loadInitialClips().then((clips) => media.filter(clips.filter((c) => c.verdict)));
  return playable;
}
