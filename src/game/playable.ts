import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';

let dealable: Promise<Clip[]> | null = null;

/**
 * The feed's clips that can be dealt: those with an answer. Their media isn't
 * checked here: a round checks each clip just before it deals it (see
 * `takeLoading` in `media.ts`), so a round never shows a black card and a game
 * costs a few requests rather than one per clip of the feed.
 */
export function loadDealableClips(): Promise<Clip[]> {
  dealable ??= loadInitialClips().then((clips) => clips.filter((c) => c.verdict));
  return dealable;
}
