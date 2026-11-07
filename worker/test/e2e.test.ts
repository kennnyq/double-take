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
  for (const c of withTells) {
    const res = await fetch(c.tells!);
    assert.equal(res.status, 200);
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
