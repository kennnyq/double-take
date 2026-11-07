import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, loadKey, NimError, redact } from './nim.ts';

const KEY = 'nvapi-SECRET123';
const respond = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function fake(responses: (Response | Error)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const opts = (fetchImpl: typeof fetch, extra = {}) => ({ fetchImpl, key: () => KEY, sleep: async () => {}, ...extra });

test('sends bearer auth, deterministic defaults and the request body', async () => {
  const { seen, fetchImpl } = fake([respond(200, { choices: [], usage: { total_tokens: 5 } })]);
  const c = createClient(opts(fetchImpl));
  await c.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], guided_json: { type: 'object' } });
  assert.match(seen[0].url, /integrate\.api\.nvidia\.com\/v1\/chat\/completions$/);
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.guided_json, { type: 'object' });
  assert.deepEqual(c.log[0], { model: 'm', status: 200, ms: c.log[0].ms, attempt: 1, usage: { total_tokens: 5 } });
});

test('retries 429/5xx and network errors, then succeeds', async () => {
  const { fetchImpl } = fake([respond(429, 'slow down'), respond(503, 'busy'), new TypeError('socket hang up'), respond(200, { ok: 1 })]);
  const c = createClient(opts(fetchImpl));
  assert.deepEqual(await c.chat({ model: 'm', messages: [] }), { ok: 1 });
  assert.deepEqual(c.log.map((l) => l.status), [429, 503, 'error', 200]);
});

test('client errors and exhausted credits are not retried', async () => {
  for (const status of [400, 404, 402]) {
    const { seen, fetchImpl } = fake([respond(status, '{"detail":"nope"}'), respond(200, {})]);
    const c = createClient(opts(fetchImpl));
    await assert.rejects(c.chat({ model: 'm', messages: [] }), (e: unknown) => e instanceof NimError && e.status === status);
    assert.equal(seen.length, 1);
  }
});

test('gives up after the retry limit', async () => {
  const { fetchImpl } = fake(Array.from({ length: 5 }, () => respond(500, 'x')));
  const c = createClient(opts(fetchImpl, { retries: 2 }));
  await assert.rejects(c.chat({ model: 'm', messages: [] }), /HTTP 500/);
  assert.equal(c.log.length, 3);
});

test('the call budget is a hard stop', async () => {
  const { fetchImpl } = fake(Array.from({ length: 5 }, () => respond(200, {})));
  const c = createClient(opts(fetchImpl, { maxCalls: 2 }));
  await c.chat({ model: 'm', messages: [] });
  await c.chat({ model: 'm', messages: [] });
  await assert.rejects(c.chat({ model: 'm', messages: [] }), /budget of 2/);
});

test('keys never appear in errors', async () => {
  assert.equal(redact(`bad key ${KEY} and Bearer ${KEY}`), 'bad key nvapi-… and Bearer …');
  const { fetchImpl } = fake([respond(401, `{"detail":"invalid key ${KEY}"}`)]);
  const c = createClient(opts(fetchImpl));
  await assert.rejects(c.chat({ model: 'm', messages: [] }), (e: unknown) => !String((e as Error).message).includes('SECRET123'));
});

test('loadKey: env var, then file, else a clear error', () => {
  assert.equal(loadKey({ NVIDIA_API_KEY: ' k ' }), 'k');
  assert.throws(() => loadKey({}), /No NVIDIA key/);
  assert.throws(() => loadKey({ NVIDIA_API_KEY_FILE: '/nonexistent/key' }), /cannot be read/);
});
