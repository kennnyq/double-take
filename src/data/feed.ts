import { makeClips, type Clip } from './clips';
import { fetchRemoteClips, toClip } from './remote';

const MIN_CLIPS = 24;

/**
 * The feed's first page: clips from the media Worker, followed by bundled
 * placeholders. With no API configured, or if the request fails, the feed is
 * placeholders only, so the app always has something to play.
 *
 * Configure in `.env.local` (git-ignored):
 *   EXPO_PUBLIC_API_URL=https://double-take-api.<subdomain>.workers.dev
 *   EXPO_PUBLIC_DEMO_PASSCODE=...
 */
export async function loadInitialClips(): Promise<Clip[]> {
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
  return [...remote, ...makeClips(remote.length, Math.max(MIN_CLIPS - remote.length, 12))];
}
