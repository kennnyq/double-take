import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USER_TABLES, devAuthEnabled, handleDevAuth, isTestEmail, type DevAuthEnv } from './devAuth.ts';
import worker from './index.ts';

const ENV: DevAuthEnv = { DEV_AUTH: '1', SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:8788${path}`, { method: 'POST', body: JSON.stringify(body), headers });

/** A fake Supabase: records calls, answers by path. */
function fakeSupabase(user: { id: string; email: string; app_metadata: { test_account?: boolean } }) {
  const calls: { method: string; path: string; apikey: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname + url.search, apikey: new Headers(init?.headers).get('apikey') });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') return ok({ msg: 'exists' }, 422);
    if (url.pathname === '/auth/v1/admin/generate_link') return ok({ properties: { hashed_token: 'hash123' }, user });
    if (url.pathname === '/auth/v1/user') return ok(user);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ALICE = { id: '11111111-1111-4111-8111-111111111111', email: 'dt-test+alice@example.com', app_metadata: { test_account: true } };

test('the routes are off unless DEV_AUTH=1 and both Supabase vars are set', () => {
  assert.equal(devAuthEnabled({}), false);
  assert.equal(devAuthEnabled({ ...ENV, DEV_AUTH: '0' }), false);
  assert.equal(devAuthEnabled({ ...ENV, SUPABASE_SECRET_KEY: '' }), false);
  assert.equal(devAuthEnabled({ ...ENV, SUPABASE_URL: undefined }), false);
  assert.equal(devAuthEnabled(ENV), true);
});

test('production (no dev vars): every /dev/* path is a 404', async () => {
  const prodEnv = { STORAGE: 'assets', DEMO_PASSCODE: 'x', SIGNING_KEY: 'y' } as unknown as Env;
  for (const path of ['/dev/session', '/dev/wipe', '/dev/delete', '/dev/anything']) {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const res = await worker.fetch!(new Request(`https://api.example${path}`, { method }) as never, prodEnv);
      assert.equal(res.status, 404, `${method} ${path}`);
    }
  }
});

test('session: only the seeded names or a fresh throwaway, and only test emails', async () => {
  assert.equal(isTestEmail('dt-test+alice@example.com'), true);
  assert.equal(isTestEmail('kenny@example.com'), false);
  const { fetchImpl } = fakeSupabase(ALICE);
  const bad = await handleDevAuth(post('/dev/session', { account: 'kenny@example.com' }), ENV, fetchImpl);
  assert.equal(bad?.status, 400);
  const get = await handleDevAuth(new Request('http://x/dev/session'), ENV, fetchImpl);
  assert.equal(get?.status, 405);
});

test('session: mints a token hash for alice with the secret key, never returning it', async () => {
  const { calls, fetchImpl } = fakeSupabase(ALICE);
  const res = await handleDevAuth(post('/dev/session', { account: 'alice' }), ENV, fetchImpl);
  assert.equal(res?.status, 200);
  const body = (await res!.json()) as Record<string, unknown>;
  assert.deepEqual(body, { email: 'dt-test+alice@example.com', token_hash: 'hash123' });
  assert.ok(calls.every((c) => c.apikey === 'sb_secret_test'));
  assert.ok(!JSON.stringify(body).includes('sb_secret'));
});

test('session: refuses a user that is not flagged as a test account', async () => {
  const { fetchImpl } = fakeSupabase({ ...ALICE, app_metadata: {} });
  const res = await handleDevAuth(post('/dev/session', { account: 'alice' }), ENV, fetchImpl);
  assert.equal(res?.status, 403);
});

test('wipe: needs a test account token, then deletes from every table', async () => {
  const none = await handleDevAuth(post('/dev/wipe'), ENV, fakeSupabase(ALICE).fetchImpl);
  assert.equal(none?.status, 401);

  const real = fakeSupabase({ ...ALICE, email: 'kenny@example.com' });
  const refused = await handleDevAuth(post('/dev/wipe', {}, { authorization: 'Bearer t' }), ENV, real.fetchImpl);
  assert.equal(refused?.status, 403);
  assert.ok(!real.calls.some((c) => c.method === 'DELETE'));

  const { calls, fetchImpl } = fakeSupabase(ALICE);
  const res = await handleDevAuth(post('/dev/wipe', {}, { authorization: 'Bearer t' }), ENV, fetchImpl);
  assert.equal(res?.status, 200);
  const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
  assert.deepEqual(
    deletes,
    USER_TABLES.map((t) => `/rest/v1/${t}?user_id=eq.${ALICE.id}`),
  );
});

test('delete: removes the test user', async () => {
  const { calls, fetchImpl } = fakeSupabase(ALICE);
  const res = await handleDevAuth(post('/dev/delete', {}, { authorization: 'Bearer t' }), ENV, fetchImpl);
  assert.equal(res?.status, 200);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `/auth/v1/admin/users/${ALICE.id}`));
});
