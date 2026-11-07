/**
 * Pure helpers for the media Worker: URL signing and byte-range headers.
 * Only Web Crypto and plain types, so they run under `node --test` as well as workerd.
 */

const DAY = 86_400;
const enc = new TextEncoder();

/**
 * Expiry for a signed URL, rounded to the end of the next UTC day. Every URL
 * stays identical for a whole day (so the player's URL-keyed cache keeps hitting)
 * and is valid for 24 to 48 hours.
 */
export function dailyExpiry(nowSeconds: number): number {
  return Math.floor(nowSeconds / DAY) * DAY + 2 * DAY;
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

const payload = (key: string, exp: number) => enc.encode(`${key}\n${exp}`);

/** Signature over an object key and its expiry. */
export async function sign(objectKey: string, exp: number, secret: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), payload(objectKey, exp)));
}

/** Constant-time check of a signature plus its expiry. */
export async function verify(
  objectKey: string,
  exp: number,
  sig: string,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < nowSeconds) return false;
  const bytes = fromB64url(sig);
  if (!bytes) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), bytes, payload(objectKey, exp));
}

/** Path plus query for a signed media URL. */
export async function signedPath(objectKey: string, secret: string, nowSeconds: number): Promise<string> {
  const exp = dailyExpiry(nowSeconds);
  const path = objectKey.split('/').map(encodeURIComponent).join('/');
  return `/m/${path}?exp=${exp}&sig=${await sign(objectKey, exp, secret)}`;
}

/** Constant-time string comparison (hash both so lengths match). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

/**
 * Parse a single-range `Range` header against an object's size (RFC 9110).
 * Returns inclusive byte bounds, `null` to ignore the header and send the whole
 * object (malformed or multi-range), or `'unsatisfiable'` for a 416.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

/** Object keys the Worker will ever serve. Archive and feeds stay private. */
export function isServableKey(key: string): boolean {
  return /^media\/[\w.-]+\/v\d+\/[\w.-]+$/.test(key) && !key.includes('..');
}

export interface FeedClip {
  id: string;
  video: string;
  poster: string;
  tells: string | null;
  /** Small silent copy for the web landing's gallery. */
  tile?: string;
  /** Alternative tells files by pipeline name (e.g. `claude`), for side-by-side comparison in dev builds. */
  tellsAlt?: Record<string, string>;
  [k: string]: unknown;
}

/** Replace a feed's object keys with absolute, signed media URLs. */
export async function signFeed<T extends { clips: FeedClip[] }>(
  feed: T,
  origin: string,
  secret: string,
  nowSeconds: number,
): Promise<T> {
  const url = async (key: string) => origin + (await signedPath(key, secret, nowSeconds));
  const clips = await Promise.all(
    feed.clips.map(async (c) => {
      const out: FeedClip = {
        ...c,
        video: await url(c.video),
        poster: await url(c.poster),
        tells: c.tells ? await url(c.tells) : null,
      };
      if (typeof c.tile === 'string' && isServableKey(c.tile)) out.tile = await url(c.tile);
      else delete out.tile;
      if (c.tellsAlt) {
        const alt: Record<string, string> = {};
        for (const [name, key] of Object.entries(c.tellsAlt)) {
          if (typeof key === 'string' && isServableKey(key)) alt[name] = await url(key);
        }
        out.tellsAlt = alt;
      }
      return out;
    }),
  );
  return { ...feed, clips };
}
