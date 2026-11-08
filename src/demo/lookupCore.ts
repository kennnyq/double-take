/**
 * `lookupDemoCheck`'s logic with the Supabase client passed in, so it runs
 * under `node --test` and in one-off scripts. The app uses `lookup.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDemoUrl } from './demoUrl.ts';

export interface DemoCheck {
  id: string;
  kind: 'file' | 'link';
  label: string;
  /** GET /jobs/<id>.result as prepared (its investigation, replay = true). Validate before use. */
  result: unknown;
  /** The full public GET /jobs/<id> envelope (`{ id, state, sha256, result, … }`), when the bundle had it. */
  job: unknown;
  /** The stored video's SHA-256 (link rows share their file row's video). */
  mediaSha256: string | null;
  /** Public URL of the prepared video, or null if it has none. */
  mediaUrl: string | null;
}

export interface DemoQuery {
  /** The file's SHA-256, hex (any case). Wins over `url` when both are given. */
  sha256?: string | null;
  /** A link as pasted; normalized here (`normalizeDemoUrl`). */
  url?: string | null;
}

export const DEMO_LOOKUP_TIMEOUT_MS = 2500;
export const DEMO_BUCKET = 'demo-media';

/**
 * Why a lookup came back empty matters: `not_found` is a clean answer (no
 * prepared check for this file or link), `unavailable` means the cloud didn't
 * answer (timeout, network or server error), so the caller can retry instead
 * of treating it as "no match".
 */
export type DemoLookup = { status: 'found'; check: DemoCheck } | { status: 'not_found' } | { status: 'unavailable' };

export async function lookupDemoCheckStatusWith(
  client: SupabaseClient | null,
  q: DemoQuery,
  { timeoutMs = DEMO_LOOKUP_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<DemoLookup> {
  try {
    // No cloud configured (local mode) or nothing to look up: nothing is prepared.
    if (!client) return { status: 'not_found' };
    const sha = q.sha256?.trim().toLowerCase();
    const url = q.url ? normalizeDemoUrl(q.url) : null;
    const column = sha && /^[0-9a-f]{64}$/.test(sha) ? 'sha256' : url ? 'normalized_url' : null;
    if (!column) return { status: 'not_found' };
    const value = column === 'sha256' ? sha! : url!;

    // AbortSignal.timeout isn't on every engine (Hermes), so a plain controller and timer.
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, timeoutMs);
    });
    const query = client
      .from('demo_checks')
      .select('id, kind, label, result, job, media_path, media_sha256')
      .eq(column, value)
      .abortSignal(ctrl.signal)
      .maybeSingle();
    const res = await Promise.race([query, timeout]).finally(() => clearTimeout(timer));
    if (!res || res.error) return { status: 'unavailable' };
    if (!res.data) return { status: 'not_found' };

    const row = res.data as {
      id: string;
      kind: 'file' | 'link';
      label: string | null;
      result: unknown;
      job: unknown;
      media_path: string | null;
      media_sha256: string | null;
    };
    const mediaUrl = row.media_path ? client.storage.from(DEMO_BUCKET).getPublicUrl(row.media_path).data.publicUrl : null;
    return {
      status: 'found',
      check: { id: row.id, kind: row.kind, label: row.label ?? '', result: row.result, job: row.job ?? null, mediaSha256: row.media_sha256 ?? null, mediaUrl },
    };
  } catch (e) {
    console.warn(`[demo] lookup failed: ${e instanceof Error ? e.message : e}`);
    return { status: 'unavailable' };
  }
}

/** The check, or null for "not found" and "unavailable" alike (never throws). */
export async function lookupDemoCheckWith(client: SupabaseClient | null, q: DemoQuery, opts?: { timeoutMs?: number }): Promise<DemoCheck | null> {
  const r = await lookupDemoCheckStatusWith(client, q, opts);
  return r.status === 'found' ? r.check : null;
}
