import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupDemoCheckStatusWith, lookupDemoCheckWith } from './lookupCore.ts';

/** A fake client: records the filter, answers with `answer` (a promise or a delay). */
function fake(answer: () => Promise<{ data: unknown; error: unknown }>) {
  const calls: [string, string][] = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      calls.push([col, val]);
      return builder;
    },
    abortSignal: () => builder,
    maybeSingle: () => answer(),
  };
  const client = {
    from: () => builder,
    storage: { from: (b: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${b}/${p}` } }) }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const row = { id: 'cat', kind: 'file', label: 'Cat', result: { state: 'complete' }, job: { id: 'j' }, media_path: 'cat/cat.mp4', media_sha256: 'ab'.repeat(32) };
const sha = 'AB'.repeat(32);

test('finds a file by SHA-256 (lower-cased) with a public media URL', async () => {
  const { client, calls } = fake(async () => ({ data: row, error: null }));
  const r = await lookupDemoCheckWith(client, { sha256: sha, url: 'https://x.com/a/status/1' });
  assert.deepEqual(calls, [['sha256', 'ab'.repeat(32)]]);
  assert.deepEqual(r, {
    id: 'cat',
    kind: 'file',
    label: 'Cat',
    result: { state: 'complete' },
    job: { id: 'j' },
    mediaSha256: 'ab'.repeat(32),
    mediaUrl: 'https://cdn.test/demo-media/cat/cat.mp4',
  });
});

test('finds a link by its normalized URL', async () => {
  const { client, calls } = fake(async () => ({ data: { ...row, kind: 'link', media_path: null }, error: null }));
  const r = await lookupDemoCheckWith(client, { url: 'twitter.com/a/status/42?s=20' });
  assert.deepEqual(calls, [['normalized_url', 'https://x.com/i/status/42']]);
  assert.equal(r?.mediaUrl, null);
});

test('null for no match, bad input, errors, throws, no client and timeouts', async () => {
  assert.equal(await lookupDemoCheckWith(fake(async () => ({ data: null, error: null })).client, { sha256: sha }), null);
  assert.equal(await lookupDemoCheckWith(fake(async () => ({ data: null, error: { message: 'x' } })).client, { sha256: sha }), null);
  const thrower = fake(async () => {
    throw new Error('offline');
  });
  assert.equal(await lookupDemoCheckWith(thrower.client, { sha256: sha }), null);
  assert.equal(await lookupDemoCheckWith(null, { sha256: sha }), null);
  const none = fake(async () => ({ data: row, error: null }));
  assert.equal(await lookupDemoCheckWith(none.client, { sha256: 'nothex', url: 'not a link' }), null);
  assert.deepEqual(none.calls, [], 'no query without a usable key');
  const slow = fake(() => new Promise((r) => setTimeout(() => r({ data: row, error: null }), 500)));
  const t0 = Date.now();
  assert.equal(await lookupDemoCheckWith(slow.client, { sha256: sha }, { timeoutMs: 30 }), null);
  assert.ok(Date.now() - t0 < 300);
});

test('tells a clean "not found" from "unavailable" (timeouts, errors, throws)', async () => {
  const status = async (answer: () => Promise<{ data: unknown; error: unknown }>, timeoutMs?: number) => (await lookupDemoCheckStatusWith(fake(answer).client, { sha256: sha }, { timeoutMs })).status;
  assert.equal(await status(async () => ({ data: row, error: null })), 'found');
  assert.equal(await status(async () => ({ data: null, error: null })), 'not_found');
  assert.equal(await status(async () => ({ data: null, error: { message: 'x' } })), 'unavailable');
  assert.equal(
    await status(async () => {
      throw new Error('offline');
    }),
    'unavailable',
  );
  assert.equal(await status(() => new Promise((r) => setTimeout(() => r({ data: row, error: null }), 200)), 20), 'unavailable');
  assert.equal((await lookupDemoCheckStatusWith(null, { sha256: sha })).status, 'not_found');
});
