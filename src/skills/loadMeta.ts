import { readTellsFile, type TellsFile } from '@/annotations/format';
import type { Clip } from '@/data/clips';
import { clipKey } from '@/social/clipRefs';
import { metaFromTells, type ClipMeta } from './meta';
import { rememberCategories } from './store';

const cache = new Map<string, Promise<ClipMeta>>();

async function tellsOf(url: string | undefined): Promise<TellsFile | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? readTellsFile(await res.json()) : null;
  } catch {
    return null;
  }
}

/** A clip's categories and difficulty prior (its tells file fetched once per session). */
export function clipMeta(clip: Clip): Promise<ClipMeta> {
  const key = clipKey(clip);
  let p = cache.get(key);
  if (!p) {
    p = tellsOf(clip.verdict === 'ai' ? clip.tellsUrl : undefined).then((file) => metaFromTells(clip, file));
    cache.set(key, p);
  }
  return p;
}

/** Metadata for every clip, a few fetches at a time; remembered (categories) for the feed's ranker. */
export async function loadMetas(clips: readonly Clip[], concurrency = 8): Promise<Map<string, ClipMeta>> {
  const out = new Map<string, ClipMeta>();
  let next = 0;
  const worker = async () => {
    while (next < clips.length) {
      const c = clips[next++];
      out.set(clipKey(c), await clipMeta(c));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, clips.length) }, worker));
  rememberCategories(new Map([...out].map(([k, m]) => [k, m.cats])));
  return out;
}
