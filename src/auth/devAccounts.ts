/**
 * Dev builds only: instant sign-in as a test account through the Worker's
 * `/dev/*` routes (worker/src/devAuth.ts). The Worker holds the Supabase secret
 * key and returns a one-time token hash; the app trades it for a real session.
 * No passwords, and no email is sent. Production builds strip all of this
 * (`__DEV__` is false), and production Workers answer 404.
 */
import { Platform } from 'react-native';
import { supabase } from './supabase';

export const TEST_ACCOUNTS = ['alice', 'bob', 'carol'] as const;
export type TestAccount = (typeof TEST_ACCOUNTS)[number] | 'fresh';

/**
 * Where the dev routes live: `EXPO_PUBLIC_DEV_AUTH_URL` from `.env.local`. On
 * web the host is swapped for the one the page was loaded from (localhost or
 * the tailnet name), keeping the port, so it works either way.
 */
export function devAuthUrl(): string | null {
  if (!__DEV__) return null;
  const configured = process.env.EXPO_PUBLIC_DEV_AUTH_URL;
  if (!configured) return null;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const port = /:(\d+)\/?$/.exec(configured)?.[1] ?? '8788';
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return configured;
}

export const devAccountsAvailable = () => __DEV__ && !!supabase && !!devAuthUrl();

async function call<T>(path: string, body: unknown, token?: string): Promise<T> {
  const base = devAuthUrl();
  if (!base) throw new Error('dev auth is not configured');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : null) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`can't reach ${base} — is \`npm run dev:auth\` running?`);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
  return json;
}

/** Sign in as a test account (created on first use), or a brand-new throwaway. */
export async function devSignIn(account: TestAccount): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { email, token_hash } = await call<{ email: string; token_hash: string }>('/dev/session', { account });
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) throw new Error(error.message);
  return email;
}

async function accessToken(): Promise<string> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (!data.session) throw new Error('not signed in');
  return data.session.access_token;
}

/** Delete every row the signed-in test account has written. */
export async function devWipe(): Promise<void> {
  await call('/dev/wipe', {}, await accessToken());
}

/** Delete the signed-in test account itself, then sign out. */
export async function devDeleteAccount(): Promise<void> {
  await call('/dev/delete', {}, await accessToken());
  await supabase?.auth.signOut({ scope: 'local' });
}
