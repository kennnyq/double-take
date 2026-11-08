import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaChecker, reachable, sourceUrl, takeLoading } from './media.ts';

function fakeFetch(status: Record<string, number>, calls: string[] = []) {
  return async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const s = status[`${init?.method ?? 'GET'} ${url}`] ?? status[url] ?? 404;
    return { ok: s >= 200 && s < 300, status: s };
  };
}

test('source URLs', () => {
  assert.equal(sourceUrl({ uri: 'https://x/v.mp4' }), 'https://x/v.mp4');
  assert.equal(sourceUrl('https://x/v.mp4'), 'https://x/v.mp4');
  assert.equal(sourceUrl(12), null);
  assert.equal(sourceUrl(null), null);
});

test('HEAD decides; a server without HEAD gets a one-byte GET', async () => {
  assert.equal(await reachable('a', fakeFetch({ 'HEAD a': 200 })), true);
  assert.equal(await reachable('a', fakeFetch({ 'HEAD a': 404 })), false);
  assert.equal(await reachable('a', fakeFetch({ 'HEAD a': 405, 'GET a': 206 })), true);
  assert.equal(await reachable('a', fakeFetch({ 'HEAD a': 405, 'GET a': 404 })), false);
  const throwing = async () => {
    throw new Error('offline');
  };
  assert.equal(await reachable('a', throwing), false);
});

test('a clip loads only if its video and poster both do; each clip is checked once', async () => {
  const calls: string[] = [];
  const check = createMediaChecker(fakeFetch({ v1: 200, p1: 200, v2: 200, p2: 404, v3: 404, p3: 200 }, calls));
  const clips = [
    { id: 'a', video: { uri: 'v1' }, poster: { uri: 'p1' } },
    { id: 'b', video: { uri: 'v2' }, poster: { uri: 'p2' } },
    { id: 'c', video: { uri: 'v3' }, poster: { uri: 'p3' } },
    { id: 'd', video: 7, poster: 8 },
  ];
  assert.deepEqual(
    (await check.filter(clips, 2)).map((c) => c.id),
    ['a', 'd'],
  );
  const before = calls.length;
  await check.filter(clips);
  assert.equal(calls.length, before, 'cached');
});

test('only the clips about to be dealt are checked: a few requests, not one per clip', async () => {
  const calls: string[] = [];
  const status: Record<string, number> = {};
  for (let i = 0; i < 200; i++) Object.assign(status, { [`v${i}`]: i === 1 ? 404 : 200, [`p${i}`]: 200 });
  const check = createMediaChecker(fakeFetch(status, calls));
  const queue = Array.from({ length: 200 }, (_, i) => ({ clip: { id: `c${i}`, video: { uri: `v${i}` }, poster: { uri: `p${i}` } } }));
  const first = await takeLoading(check, queue, 3);
  // c1 fails, so c3 is checked in its place; the other 196 stay unchecked.
  assert.deepEqual(first.map((d) => d.clip.id), ['c0', 'c2', 'c3']);
  assert.equal(queue.length, 196);
  assert.equal(calls.length, 8);
  assert.equal(check.known({ id: 'c1', video: 0, poster: 0 }), false);
  assert.equal(check.known({ id: 'c2', video: 0, poster: 0 }), true);
  assert.equal(check.known({ id: 'c4', video: 0, poster: 0 }), undefined);
  // Checked again later (an untimed game's next batch): from the session's results, no new requests.
  const again = await takeLoading(check, [{ clip: { id: 'c0', video: { uri: 'v0' }, poster: { uri: 'p0' } } }], 1);
  assert.equal(again.length, 1);
  assert.equal(calls.length, 8);
});
