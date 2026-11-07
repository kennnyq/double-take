import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyExpiry,
  isServableKey,
  parseRange,
  safeEqual,
  sign,
  signFeed,
  signedPath,
  verify,
} from './lib.ts';

const KEY = 'media/x-1/v1/720.mp4';
const SECRET = 'test-secret';
const NOW = 1_794_000_123; // 2026-11-06T…Z

test('dailyExpiry is stable within a UTC day and lands 24-48h ahead', () => {
  const dayStart = Math.floor(NOW / 86_400) * 86_400;
  assert.equal(dailyExpiry(dayStart), dailyExpiry(dayStart + 86_399));
  assert.notEqual(dailyExpiry(dayStart), dailyExpiry(dayStart + 86_400));
  const exp = dailyExpiry(NOW);
  assert.ok(exp - NOW > 86_400 && exp - NOW <= 2 * 86_400);
});

test('verify accepts its own signature', async () => {
  const exp = dailyExpiry(NOW);
  assert.ok(await verify(KEY, exp, await sign(KEY, exp, SECRET), SECRET, NOW));
});

test('verify rejects tampering, other keys, other secrets and expiry', async () => {
  const exp = dailyExpiry(NOW);
  const sig = await sign(KEY, exp, SECRET);
  assert.equal(await verify('media/x-2/v1/720.mp4', exp, sig, SECRET, NOW), false);
  assert.equal(await verify(KEY, exp + 1, sig, SECRET, NOW), false);
  assert.equal(await verify(KEY, exp, sig, 'other-secret', NOW), false);
  assert.equal(await verify(KEY, exp, sig.slice(0, -2) + 'AA', SECRET, NOW), false);
  assert.equal(await verify(KEY, exp, 'not base64!', SECRET, NOW), false);
  assert.equal(await verify(KEY, exp, sig, SECRET, exp + 1), false);
  assert.equal(await verify(KEY, NaN, sig, SECRET, NOW), false);
});

test('signedPath produces a verifiable /m/ URL', async () => {
  const path = await signedPath(KEY, SECRET, NOW);
  const url = new URL(path, 'https://x.test');
  assert.equal(url.pathname, `/m/${KEY}`);
  assert.ok(await verify(KEY, Number(url.searchParams.get('exp')), url.searchParams.get('sig')!, SECRET, NOW));
});

test('parseRange handles closed, open-ended and suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=0-1023', 4096), { start: 0, end: 1023 });
  assert.deepEqual(parseRange('bytes=4000-', 4096), { start: 4000, end: 4095 });
  assert.deepEqual(parseRange('bytes=-500', 4096), { start: 3596, end: 4095 });
  assert.deepEqual(parseRange('bytes=-9000', 4096), { start: 0, end: 4095 });
  assert.deepEqual(parseRange('bytes=0-1', 4096), { start: 0, end: 1 }); // AVPlayer's probe
  assert.deepEqual(parseRange('bytes=4000-99999', 4096), { start: 4000, end: 4095 });
});

test('parseRange rejects out-of-bounds ranges and ignores malformed ones', () => {
  assert.equal(parseRange('bytes=4096-', 4096), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 4096), 'unsatisfiable');
  assert.equal(parseRange(null, 4096), null);
  assert.equal(parseRange('bytes=-', 4096), null);
  assert.equal(parseRange('bytes=0-10,20-30', 4096), null);
  assert.equal(parseRange('items=0-10', 4096), null);
  assert.equal(parseRange('bytes=10-5', 4096), null);
});

test('only media objects are servable', () => {
  assert.ok(isServableKey('media/x-2023151052800000040/v1/720.mp4'));
  assert.ok(isServableKey('media/yt-FXo1pGCcSo8/v1/tells.json'));
  assert.equal(isServableKey('archive/abc/original.mp4'), false);
  assert.equal(isServableKey('feeds/demo.json'), false);
  assert.equal(isServableKey('media/../archive/x/v1/a.mp4'), false);
  assert.equal(isServableKey('media/x/v1/../../feeds/demo.json'), false);
});

test('safeEqual', async () => {
  assert.ok(await safeEqual('abc', 'abc'));
  assert.equal(await safeEqual('abc', 'abd'), false);
  assert.equal(await safeEqual('', 'abc'), false);
});

test('signFeed signs every media field and keeps the rest', async () => {
  const feed = {
    version: 1,
    clips: [
      {
        id: 'a',
        video: 'media/a/v1/720.mp4',
        poster: 'media/a/v1/poster.jpg',
        tells: 'media/a/v1/tells.json',
        tellsAlt: { claude: 'media/a/v1/tells.abc.json', bad: 'feeds/demo.json' },
        tile: 'media/a/v1/tile.mp4',
        label: 'confirmed',
      },
      { id: 'b', video: 'media/b/v1/720.mp4', poster: 'media/b/v1/poster.jpg', tells: null, tile: 'feeds/demo.json' },
    ],
  };
  const out = await signFeed(feed, 'https://api.test', SECRET, NOW);
  assert.equal(out.version, 1);
  assert.equal(out.clips[0].label, 'confirmed');
  assert.match(out.clips[0].video, /^https:\/\/api\.test\/m\/media\/a\/v1\/720\.mp4\?exp=\d+&sig=[\w-]+$/);
  assert.match(out.clips[0].tells!, /tells\.json\?exp=/);
  assert.equal(out.clips[1].tells, null);
  // Alternatives are signed too; a key the Worker would never serve is dropped, not signed.
  assert.match(out.clips[0].tellsAlt!.claude, /^https:\/\/api\.test\/m\/media\/a\/v1\/tells\.abc\.json\?exp=/);
  assert.deepEqual(Object.keys(out.clips[0].tellsAlt!), ['claude']);
  assert.equal(out.clips[1].tellsAlt, undefined);
  // The gallery tile is signed like the video; an unservable key is dropped.
  assert.match(out.clips[0].tile as string, /^https:\/\/api\.test\/m\/media\/a\/v1\/tile\.mp4\?exp=/);
  assert.equal('tile' in out.clips[1], false);
});
