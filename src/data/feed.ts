import { makeClips, type Clip } from './clips';
import { fetchRemoteClips, toClip } from './remote';
import { orderFeed } from '@/engagement/feedOrder';
import { devSettings } from '@/devtools/store';
import { rankClips } from './rank';
import './devSection';

const MIN_CLIPS = 24;

let initial: Promise<Clip[]> | null = null;
let sessionOrder: 'best' | 'original' | undefined;
/** Cached alongside the feed so a setting change cannot alter Game until reload. */
export const initialFeedOrder = () => sessionOrder ?? devSettings.getSnapshot().feedOrder;

/**
 * The feed's first page: clips from the media Worker, followed by bundled
 * placeholders. With no API configured, or if the request fails, the feed is
 * placeholders only, so the app always has something to play.
 *
 * Configure in `.env.local` (git-ignored):
 *   EXPO_PUBLIC_API_URL=https://double-take-api.<subdomain>.workers.dev
 *   EXPO_PUBLIC_DEMO_PASSCODE=...
 */
export function loadInitialClips(): Promise<Clip[]> {
  // One request per session: the web landing and the feed share it.
  sessionOrder ??= devSettings.getSnapshot().feedOrder;
  initial ??= load();
  return initial;
}

async function load(): Promise<Clip[]> {
  // Must be written out in full: Expo only inlines literal `process.env.EXPO_PUBLIC_*`.
  const url = process.env.EXPO_PUBLIC_API_URL;
  const passcode = process.env.EXPO_PUBLIC_DEMO_PASSCODE;
  let remote: Clip[] = [];
  if (url && passcode) {
    try {
      remote = (await fetchRemoteClips(url, passcode)).map(toClip);
    } catch (e) {
      console.warn(`[feed] using placeholders only: ${e instanceof Error ? e.message : e}`);
    }
  }
  const clips = [...remote, ...makeClips(remote.length, Math.max(MIN_CLIPS - remote.length, 12))];
  // Read once: all consumers retain the same positional ids until reload.
  // Best first takes precedence over experimental engagement personalization.
  const ordered = initialFeedOrder() === 'best' ? rankClips(clips) : orderFeed(clips);
  return ordered.map((clip, index) => ({ ...clip, id: `clip-${index}` }));
}
