/**
 * Dev-only test accounts for the app's Accounts tab (`npm run dev:auth`).
 *
 *   POST /dev/session {account: 'alice'|'bob'|'carol'|'fresh'}  → {email, token_hash}
 *   POST /dev/wipe     (Authorization: Bearer <access token>)    → deletes the caller's rows
 *   POST /dev/delete   (Authorization: Bearer <access token>)    → deletes the caller's account
 *
 * The app trades `token_hash` for a real session with
 * `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`: no password, and
 * no email is sent.
 *
 * Mounted only when `DEV_AUTH=1` and `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
 * are all set, which only `worker/.dev.vars` does. Production has none of them,
 * so every `/dev/*` path is a 404 there. Even when mounted, only flagged test
 * accounts (`app_metadata.test_account`, `dt-test+<name>@example.com`) can be
 * minted, wiped or deleted.
 */

export interface DevAuthEnv {
  DEV_AUTH?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export const DEV_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

const SEEDED = ['alice', 'bob', 'carol'] as const;
const DISPLAY: Record<string, string> = { alice: 'Alice Test', bob: 'Bob Test', carol: 'Carol Test' };

/** Every table holding a user's rows (comments cascade their replies). */
export const USER_TABLES = ['comment_likes', 'comments', 'likes', 'saves', 'reposts', 'sends', 'follows'] as const;

export function devAuthEnabled(env: DevAuthEnv): boolean {
  return env.DEV_AUTH === '1' && !!env.SUPABASE_URL && !!env.SUPABASE_SECRET_KEY;
}

export const testEmail = (name: string) => `dt-test+${name}@example.com`;
export const isTestEmail = (email: unknown) => typeof email === 'string' && /^dt-test\+[a-z0-9-]{1,32}@example\.com$/.test(email);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...DEV_CORS },
  });
const fail = (status: number, error: string) => json({ error }, status);

interface User {
  id: string;
  email?: string;
  app_metadata?: { test_account?: boolean };
}

/** Handles `/dev/*`; returns null for other paths. Callers must check `devAuthEnabled` first. */
export async function handleDevAuth(request: Request, env: DevAuthEnv, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/dev/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: DEV_CORS });
  if (request.method !== 'POST') return fail(405, 'method not allowed');

  const base = env.SUPABASE_URL!.replace(/\/+$/, '');
  // New-style secret keys go in `apikey` only (Authorization must be a JWT).
  const admin = (path: string, init: RequestInit = {}) =>
    fetchImpl(`${base}${path}`, {
      ...init,
      headers: { apikey: env.SUPABASE_SECRET_KEY!, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });

  if (pathname === '/dev/session') {
    const body = (await request.json().catch(() => ({}))) as { account?: unknown };
    const account = body.account;
    let name: string;
    if (account === 'fresh') name = `t${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    else if (typeof account === 'string' && (SEEDED as readonly string[]).includes(account)) name = account;
    else return fail(400, 'account must be alice, bob, carol or fresh');
    const email = testEmail(name);
    if (!isTestEmail(email)) return fail(400, 'not a test email');

    // Created on first use; "already exists" is fine.
    const created = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        email_confirm: true,
        app_metadata: { test_account: true },
        user_metadata: { handle_hint: name, display_name: DISPLAY[name] ?? 'Throwaway Test' },
      }),
    });
    if (!created.ok && created.status !== 422) return fail(502, `create user failed (${created.status})`);

    const link = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
    if (!link.ok) return fail(502, `generate link failed (${link.status})`);
    const data = (await link.json()) as {
      hashed_token?: string;
      properties?: { hashed_token?: string };
      app_metadata?: User['app_metadata'];
      user?: User;
    };
    const meta = data.user?.app_metadata ?? data.app_metadata;
    if (meta?.test_account !== true) return fail(403, 'not a test account');
    const token_hash = data.properties?.hashed_token ?? data.hashed_token;
    if (!token_hash) return fail(502, 'no token in the generated link');
    return json({ email, token_hash });
  }

  if (pathname === '/dev/wipe' || pathname === '/dev/delete') {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return fail(401, 'missing access token');
    const me = await admin('/auth/v1/user', { headers: { authorization: `Bearer ${token}` } });
    if (!me.ok) return fail(401, 'bad access token');
    const user = (await me.json()) as User;
    if (user.app_metadata?.test_account !== true || !isTestEmail(user.email)) return fail(403, 'only test accounts can be wiped or deleted');
    if (!/^[0-9a-f-]{36}$/i.test(user.id)) return fail(400, 'bad user id');

    if (pathname === '/dev/delete') {
      const del = await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
      return del.ok ? json({ deleted: user.email }) : fail(502, `delete failed (${del.status})`);
    }
    for (const table of USER_TABLES) {
      const res = await admin(`/rest/v1/${table}?user_id=eq.${user.id}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      if (!res.ok) return fail(502, `wiping ${table} failed (${res.status})`);
    }
    return json({ wiped: user.email });
  }

  return fail(404, 'not found');
}
