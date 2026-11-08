/**
 * End-to-end checks against a running Worker, local or deployed.
 *
 *   BASE_URL=http://localhost:8787 node --test test/e2e.test.ts          (default; passcode read from .dev.vars)
 *   BASE_URL=https://double-take-api.<you>.workers.dev DEMO_PASSCODE=... node --test test/e2e.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = (process.env.BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');

function passcode(): string {
  if (process.env.DEMO_PASSCODE) return process.env.DEMO_PASSCODE;
  const vars = readFileSync(resolve(import.meta.dirname, '../.dev.vars'), 'utf8');
  const m = vars.match(/^DEMO_PASSCODE=(.*)$/m);
  if (!m) throw new Error('DEMO_PASSCODE not set and not found in .dev.vars');
  return m[1].trim().replace(/^"|"$/g, '');
}

interface Clip {
  id: string;
  video: string;
  poster: string;
  tells: string | null;
  tellsAlt?: Record<string, string>;
  width: number;
  height: number;
  duration: number;
}

let feedCache: { clips: Clip[] } | null = null;
async function feed(): Promise<{ clips: Clip[] }> {
  if (feedCache) return feedCache;
  const res = await fetch(`${BASE}/feed`, { headers: { authorization: `Bearer ${passcode()}` } });
  assert.equal(res.status, 200, await res.clone().text());
  feedCache = (await res.json()) as { clips: Clip[] };
  return feedCache;
}

test('health', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);
});

test('feed requires the passcode', async () => {
  assert.equal((await fetch(`${BASE}/feed`)).status, 401);
  assert.equal((await fetch(`${BASE}/feed`, { headers: { authorization: 'Bearer nope' } })).status, 401);
});

test('feed lists clips with absolute signed URLs', async () => {
  const { clips } = await feed();
  assert.ok(clips.length >= 10, `expected 10+ clips, got ${clips.length}`);
  for (const c of clips) {
    assert.match(c.video, new RegExp(`^${BASE.replace(/[.]/g, '\\.')}/m/media/.+/720\\.mp4\\?exp=\\d+&sig=[\\w-]+$`));
    assert.match(c.poster, /poster\.jpg\?exp=/);
    assert.ok(c.width > 0 && c.height > 0 && c.duration > 0);
  }
});

test('video answers byte ranges with 206 and correct headers', async () => {
  const { clips } = await feed();
  const res = await fetch(clips[0].video, { headers: { range: 'bytes=0-1023' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.match(res.headers.get('content-range') ?? '', /^bytes 0-1023\/\d+$/);
  assert.equal(res.headers.get('content-length'), '1024');
  const head = new Uint8Array(await res.arrayBuffer());
  assert.equal(head.length, 1024);
  assert.equal(new TextDecoder().decode(head.slice(4, 8)), 'ftyp');
});

test('suffix and open-ended ranges', async () => {
  const { clips } = await feed();
  const total = Number((await fetch(clips[0].video, { method: 'HEAD' })).headers.get('content-length'));
  assert.ok(total > 10_000);

  const tail = await fetch(clips[0].video, { headers: { range: 'bytes=-500' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${total - 500}-${total - 1}/${total}`);
  assert.equal((await tail.arrayBuffer()).byteLength, 500);

  const rest = await fetch(clips[0].video, { headers: { range: `bytes=${total - 100}-` } });
  assert.equal(rest.status, 206);
  assert.equal((await rest.arrayBuffer()).byteLength, 100);

  // AVPlayer opens with a 2-byte probe and needs the total size back.
  const probe = await fetch(clips[0].video, { headers: { range: 'bytes=0-1' } });
  assert.equal(probe.status, 206);
  assert.equal(probe.headers.get('content-range'), `bytes 0-1/${total}`);
  assert.equal((await probe.arrayBuffer()).byteLength, 2);

  const beyond = await fetch(clips[0].video, { headers: { range: `bytes=${total}-` } });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), `bytes */${total}`);
});

test('videos are fast-start (moov atom before media data)', async () => {
  const { clips } = await feed();
  for (const c of clips) {
    const res = await fetch(c.video, { headers: { range: 'bytes=0-65535' } });
    const text = new TextDecoder('latin1').decode(await res.arrayBuffer());
    const moov = text.indexOf('moov');
    const mdat = text.indexOf('mdat');
    assert.ok(moov > 0 && (mdat === -1 || moov < mdat), `${c.id}: moov should come before mdat`);
  }
});

test('every listed clip serves its video and poster', async () => {
  // A feed row whose files weren't uploaded (or staged) plays as a black card.
  const { clips } = await feed();
  const missing: string[] = [];
  for (const c of clips) {
    for (const url of [c.video, c.poster]) {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status !== 200) missing.push(`${c.id} ${new URL(url).pathname.split('/').pop()} → ${res.status}`);
    }
  }
  assert.deepEqual(missing, [], `${missing.length} of ${clips.length * 2} media files missing`);
});

test('full GET without Range returns 200 with the whole file', async () => {
  const { clips } = await feed();
  const smallest = clips.reduce((a, b) => (a.duration < b.duration ? a : b));
  const res = await fetch(smallest.video);
  assert.equal(res.status, 200);
  assert.equal(Number(res.headers.get('content-length')), (await res.arrayBuffer()).byteLength);
});

test('etag revalidation returns 304', async () => {
  const { clips } = await feed();
  const first = await fetch(clips[0].poster);
  await first.arrayBuffer();
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const again = await fetch(clips[0].poster, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('posters are JPEGs', async () => {
  const { clips } = await feed();
  const res = await fetch(clips[0].poster);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const b = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([b[0], b[1]], [0xff, 0xd8]);
});

test('tells are served and well-formed', async () => {
  const { clips } = await feed();
  const withTells = clips.filter((c) => c.tells);
  assert.ok(withTells.length >= 3, `expected 3+ clips with tells, got ${withTells.length}`);
  // Main tells plus any alternative pipelines' files (compared in dev builds).
  const files = clips.flatMap((c) => [
    ...(c.tells ? [{ c, name: 'main', url: c.tells }] : []),
    ...Object.entries(c.tellsAlt ?? {}).map(([name, url]) => ({ c, name, url })),
  ]);
  for (const { c, name, url } of files) {
    const res = await fetch(url);
    assert.equal(res.status, 200, `${c.id} [${name}]`);
    const file = (await res.json()) as {
      version: number;
      tells: { t0: number; t1: number; box?: Record<string, number> }[];
      unplaced?: { quote: string; from: string }[];
    };
    // v2 files may hold only claims that couldn't be placed on the video.
    assert.ok(file.tells.length + (file.unplaced?.length ?? 0) > 0, `${c.id}: empty tells file`);
    for (const t of file.tells) {
      assert.ok(t.t0 >= 0 && t.t1 > t.t0 && t.t1 <= c.duration + 0.5, `${c.id}: bad time range`);
      // Box-less steps are allowed (a timed claim with no place on screen).
      if (!t.box) continue;
      const { x, y, w, h } = t.box;
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001, `${c.id}: box outside frame`);
    }
  }
});

interface CompareClip extends Clip {
  label?: string | null;
  tier?: string;
  pairOf?: string;
}

test('compare feed (?name=compare) pairs real clips with AI ones', async () => {
  const res = await fetch(`${BASE}/feed?name=compare`, { headers: { authorization: `Bearer ${passcode()}` } });
  assert.equal(res.status, 200, await res.clone().text());
  const { clips } = (await res.json()) as { clips: CompareClip[] };
  const byId = new Map(clips.map((c) => [c.id, c]));
  const real = clips.filter((c) => c.label === 'real');
  assert.ok(real.length >= 5, `expected 5+ real clips, got ${real.length}`);
  for (const c of real) {
    assert.match(c.tier ?? '', /^real-(verified|prior|agency)$/, `${c.id}: real clips say how we know`);
  }
  const paired = real.filter((c) => c.pairOf);
  assert.ok(paired.length >= 3, `expected 3+ pairs, got ${paired.length}`);
  for (const c of paired) {
    // Each pair ships with its AI clip, so the feed stands on its own.
    assert.equal(byId.get(c.pairOf!)?.label, 'confirmed', `${c.id}: pairOf ${c.pairOf} should be an AI clip in this feed`);
  }
  // Media is signed the same way as demo's, and a real clip's video plays.
  for (const c of clips) assert.match(c.video, /\/720\.mp4\?exp=\d+&sig=/);
  const media = await fetch(real[0].video, { headers: { range: 'bytes=0-1' } });
  assert.equal(media.status, 206);
});

test('unknown feeds are 404 and bad names 400', async () => {
  const auth = { authorization: `Bearer ${passcode()}` };
  assert.equal((await fetch(`${BASE}/feed?name=nope-not-a-feed`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${BASE}/feed?name=..%2Fdemo`, { headers: auth })).status, 400);
});

test('tampered or missing signatures are rejected', async () => {
  const { clips } = await feed();
  const u = new URL(clips[0].video);
  const sig = u.searchParams.get('sig')!;
  u.searchParams.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
  assert.equal((await fetch(u)).status, 403);
  assert.equal((await fetch(clips[0].video.split('?')[0])).status, 403);
  // A valid signature for one clip does not unlock another.
  const other = new URL(clips[1].video);
  other.search = new URL(clips[0].video).search;
  assert.equal((await fetch(other)).status, 403);
});

test('archive and feed objects are never served directly', async () => {
  const { clips } = await feed();
  const q = new URL(clips[0].video).search;
  assert.equal((await fetch(`${BASE}/m/archive/abc/original.mp4${q}`)).status, 404);
  assert.equal((await fetch(`${BASE}/m/feeds/demo.json${q}`)).status, 404);
});

test('CORS preflight for Range requests (web build)', async () => {
  const { clips } = await feed();
  const res = await fetch(clips[0].video, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /range/);
});

test('dev-only test-account routes are absent on deployed Workers', { skip: /localhost|127\.0\.0\.1/.test(BASE) }, async () => {
  for (const path of ['/dev/session', '/dev/wipe', '/dev/delete']) {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', body: '{"account":"alice"}', headers: { 'content-type': 'application/json' } });
    // 404 once this code is deployed (no DEV_AUTH in production); 405 from a Worker
    // deployed before the dev routes existed, which rejects every POST.
    assert.ok([404, 405].includes(res.status), `${path}: ${res.status}`);
    assert.ok(!(await res.text()).includes('token_hash'));
  }
});
