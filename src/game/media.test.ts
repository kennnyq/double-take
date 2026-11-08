import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaChecker, reachable, sourceUrl } from './media.ts';

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
