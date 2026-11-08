/**
 * Which clips' media actually loads. The feed's index can list clips whose
 * files aren't in storage (the local Worker lists 82 clips but serves media
 * for 49; the rest answer 404), and such a clip plays as a black card. The
 * round only deals clips that pass this check. Pure over an injectable
 * `fetch`, so it runs under `node --test`.
 */

export interface MediaSource {
  id: string;
  sourceId?: string;
  /** expo-video's source: a bundled asset (number), a URL, or `{ uri }`. */
  video: unknown;
  poster: unknown;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** The URL behind a source, or null for a bundled asset (always there). */
export function sourceUrl(src: unknown): string | null {
  if (typeof src === 'string') return src;
  if (src && typeof src === 'object' && typeof (src as { uri?: unknown }).uri === 'string') return (src as { uri: string }).uri;
  return null;
}

/** Whether a URL answers with content: HEAD, or a one-byte GET where HEAD isn't allowed. */
export async function reachable(url: string, fetchFn: Fetch, timeoutMs = 6000): Promise<boolean> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const head = await fetchFn(url, { method: 'HEAD', signal: ctrl?.signal });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 501) return false;
    const get = await fetchFn(url, { headers: { Range: 'bytes=0-0' }, signal: ctrl?.signal });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface MediaChecker {
  /** Whether both the clip's video and its poster load. Each clip is checked once per session. */
  loads(clip: MediaSource): Promise<boolean>;
  /** The clips that load, in their order; at most `concurrency` checks at once. */
  filter<T extends MediaSource>(clips: readonly T[], concurrency?: number): Promise<T[]>;
}

export function createMediaChecker(fetchFn: Fetch): MediaChecker {
  const cache = new Map<string, Promise<boolean>>();
  const loads = (clip: MediaSource) => {
    const key = clip.sourceId ?? clip.id;
    let p = cache.get(key);
    if (!p) {
      const urls = [sourceUrl(clip.video), sourceUrl(clip.poster)].filter((u): u is string => u !== null);
      p = Promise.all(urls.map((u) => reachable(u, fetchFn))).then((oks) => oks.every(Boolean));
      cache.set(key, p);
    }
    return p;
  };
  return {
    loads,
    async filter(clips, concurrency = 8) {
      const ok: boolean[] = new Array(clips.length).fill(false);
      let next = 0;
      const worker = async () => {
        while (next < clips.length) {
          const i = next++;
          ok[i] = await loads(clips[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, clips.length) }, worker));
      return clips.filter((_, i) => ok[i]);
    },
  };
}

/** The app's checker, on the platform's fetch. */
export const media: MediaChecker = createMediaChecker((url, init) => fetch(url, init as RequestInit));
