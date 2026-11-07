/**
 * Double Take media API.
 *
 *   GET  /health            liveness, plus which storage backend is active
 *   GET  /feed[?name=demo]  feed JSON with signed media URLs (needs `Authorization: Bearer <DEMO_PASSCODE>`)
 *   GET  /m/<key>?exp&sig   media bytes, with HTTP Range support (HEAD works too)
 *
 * Every request runs through this Worker first (`run_worker_first`), so media is
 * only reachable with a valid signature, whichever storage backend holds it.
 */
import { isServableKey, safeEqual, signFeed, verify, type FeedClip } from './lib.ts';
import { storageFor, type Meta } from './storage.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'authorization, range, if-none-match',
  'access-control-expose-headers': 'content-range, content-length, accept-ranges, etag',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });

const error = (status: number, message: string) => json({ error: message }, status, { 'cache-control': 'no-store' });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method not allowed');

    if (url.pathname === '/health') return json({ ok: true, storage: env.STORAGE === 'r2' ? 'r2' : 'assets' });
    if (url.pathname === '/feed') return feed(request, env, url);
    if (url.pathname.startsWith('/m/')) return media(request, env, url);
    return error(404, 'not found');
  },
} satisfies ExportedHandler<Env>;

async function feed(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.DEMO_PASSCODE || !(await safeEqual(token, env.DEMO_PASSCODE))) return error(401, 'bad passcode');

  const name = url.searchParams.get('name') ?? 'demo';
  if (!/^[\w-]+$/.test(name)) return error(400, 'bad feed name');
  const data = await storageFor(env).json<{ clips: FeedClip[] }>(`feeds/${name}.json`);
  if (!data) return error(404, 'feed not found');

  const signed = await signFeed(data, url.origin, env.SIGNING_KEY, Date.now() / 1000);
  return json(signed, 200, { 'cache-control': 'private, no-store' });
}

function mediaHeaders(m: Meta): Headers {
  const h = new Headers(CORS);
  h.set('accept-ranges', 'bytes');
  h.set('content-type', m.contentType);
  if (m.etag) h.set('etag', m.etag);
  // Signed URLs change daily, so a day of private caching is safe.
  h.set('cache-control', 'private, max-age=86400');
  return h;
}

async function media(request: Request, env: Env, url: URL): Promise<Response> {
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(3));
  } catch {
    return error(400, 'bad path');
  }
  if (!isServableKey(key)) return error(404, 'not found');

  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  // Checked before any storage read, so bad requests cost nothing downstream.
  if (!(await verify(key, exp, sig, env.SIGNING_KEY, Date.now() / 1000))) return error(403, 'bad or expired signature');

  const store = storageFor(env);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (request.method === 'HEAD' || ifNoneMatch) {
    const m = await store.head(key);
    if (!m) return error(404, 'not found');
    const headers = mediaHeaders(m);
    if (ifNoneMatch && m.etag && ifNoneMatch.split(',').some((t) => t.trim() === m.etag)) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') {
      headers.set('content-length', String(m.size));
      return new Response(null, { status: 200, headers });
    }
  }

  const r = await store.read(key, request.headers.get('range'));
  if (r.kind === 'missing') return error(404, 'not found');
  if (r.kind === 'unsatisfiable') {
    const headers = new Headers(CORS);
    headers.set('content-range', `bytes */${r.size}`);
    return new Response(null, { status: 416, headers });
  }

  const headers = mediaHeaders(r);
  if (r.range) {
    headers.set('content-range', `bytes ${r.range.start}-${r.range.end}/${r.size}`);
    headers.set('content-length', String(r.range.end - r.range.start + 1));
    return new Response(sized(r.body, r.range.end - r.range.start + 1), { status: 206, headers });
  }
  headers.set('content-length', String(r.size));
  return new Response(sized(r.body, r.size), { status: 200, headers });
}

/**
 * workerd drops Content-Length on a stream of unknown length and falls back to
 * chunked encoding. Players need the length on 206 responses, so declare it.
 */
function sized(body: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const { readable, writable } = new FixedLengthStream(length);
  body.pipeTo(writable).catch(() => {}); // client hung up; nothing to clean up
  return readable;
}
