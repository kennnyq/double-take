/**
 * Where media lives. Two interchangeable backends:
 *
 *   assets  Workers Static Assets, deployed with the Worker. Free and works on the
 *           Workers Free plan with no payment method. Assets ignore Range, so byte
 *           ranges are cut here from the full stream.
 *   r2      A private R2 bucket. Needs R2 enabled (payment method on file); ranges
 *           are read natively.
 *
 * Pick one with the STORAGE var in wrangler.jsonc.
 */
import { parseRange } from './lib.ts';

export interface Meta {
  size: number;
  etag: string;
  contentType: string;
}

export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'unsatisfiable'; size: number }
  | ({ kind: 'ok'; body: ReadableStream<Uint8Array>; range: { start: number; end: number } | null } & Meta);

export interface Storage {
  head(key: string): Promise<Meta | null>;
  read(key: string, rangeHeader: string | null): Promise<ReadResult>;
  json<T>(key: string): Promise<T | null>;
}

/** Pass through only bytes start..end (inclusive) of a stream, then stop reading. */
export function sliceStream(src: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = src.getReader();
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          ctrl.close();
          return;
        }
        const chunkStart = pos;
        pos += value.length;
        if (pos <= start) continue; // still before the range
        const from = Math.max(0, start - chunkStart);
        const to = Math.min(value.length, end + 1 - chunkStart);
        if (to > from) ctrl.enqueue(value.subarray(from, to));
        if (pos > end) {
          ctrl.close();
          await reader.cancel();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Written by scripts/stage.ts: size, type and content hash of every servable asset. */
export const ASSET_MANIFEST = 'asset-manifest.json';

// One manifest load per isolate; a deploy starts fresh isolates, so it never goes stale in the cloud.
let manifestCache: { assets: Fetcher; manifest: Promise<Record<string, Meta>> } | null = null;

export function assetStorage(assets: Fetcher): Storage {
  // Any origin works: the binding only looks at the path.
  const get = (key: string) => assets.fetch(new Request(`https://assets.local/${key}`));

  // The assets binding sends no Content-Length, and a player cannot seek without
  // the size, so sizes come from the manifest instead. It doubles as an allowlist.
  const manifest = () => {
    if (manifestCache?.assets !== assets) {
      const manifest = get(ASSET_MANIFEST).then(async (res) => {
        if (!res.ok) throw new Error(`${ASSET_MANIFEST} missing; run scripts/stage.ts before dev/deploy`);
        return (await res.json()) as Record<string, Meta>;
      });
      manifest.catch(() => (manifestCache = null)); // retry on the next request
      manifestCache = { assets, manifest };
    }
    return manifestCache.manifest;
  };

  return {
    async head(key) {
      return (await manifest())[key] ?? null;
    },
    async read(key, rangeHeader) {
      const m = (await manifest())[key];
      if (!m) return { kind: 'missing' };
      const range = parseRange(rangeHeader, m.size);
      if (range === 'unsatisfiable') return { kind: 'unsatisfiable', size: m.size };
      const res = await get(key);
      if (!res.ok || !res.body) return { kind: 'missing' };
      const body = range ? sliceStream(res.body, range.start, range.end) : res.body;
      return { kind: 'ok', body, range, ...m };
    },
    async json<T>(key: string) {
      const res = await get(key);
      return res.ok ? ((await res.json()) as T) : null;
    },
  };
}

export function r2Storage(bucket: R2Bucket): Storage {
  const meta = (o: R2Object): Meta => ({
    size: o.size,
    etag: o.httpEtag,
    contentType: o.httpMetadata?.contentType ?? 'application/octet-stream',
  });

  return {
    async head(key) {
      const o = await bucket.head(key);
      return o ? meta(o) : null;
    },
    async read(key, rangeHeader) {
      let range: { start: number; end: number } | null = null;
      if (rangeHeader) {
        const o = await bucket.head(key);
        if (!o) return { kind: 'missing' };
        const parsed = parseRange(rangeHeader, o.size);
        if (parsed === 'unsatisfiable') return { kind: 'unsatisfiable', size: o.size };
        range = parsed;
      }
      const o = await bucket.get(key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {});
      if (!o) return { kind: 'missing' };
      return { kind: 'ok', body: o.body, range, ...meta(o) };
    },
    async json<T>(key: string) {
      const o = await bucket.get(key);
      return o ? ((await o.json()) as T) : null;
    },
  };
}

export function storageFor(env: Env): Storage {
  if (env.STORAGE === 'r2') {
    if (!env.MEDIA) throw new Error('STORAGE is "r2" but no MEDIA R2 binding is configured');
    return r2Storage(env.MEDIA);
  }
  return assetStorage(env.ASSETS);
}
