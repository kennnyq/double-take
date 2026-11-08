import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AUTH_STORAGE_KEY } from '@/auth/config';
import { TEST_ACCOUNTS, devAccountsAvailable, devAuthUrl, devDeleteAccount, devSignIn, devWipe, type TestAccount } from '@/auth/devAccounts';
import { isTestEmail } from '@/auth/member';
import { signOut, useAuth } from '@/auth/store';
import { usernameFromEmail } from '@/auth/username';
import { supabase } from '@/auth/supabase';
import { reloadSocial } from '@/social/SocialSync';

/**
 * Dev builds: who you are signed in as, one-tap switching between guest and
 * test accounts (through the Worker's dev routes), wiping a test account's
 * data, and simulating token expiry.
 */
export function AccountsTab() {
  const auth = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const now = useNow();

  if (!supabase) {
    return <Text style={styles.note}>Supabase isn’t configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (local mode: nothing is gated or saved).</Text>;
  }

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setNote(null);
    try {
      const msg = await fn();
      setNote({ text: msg || `${label}: done` });
    } catch (e) {
      setNote({ text: `${label}: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
    setBusy(null);
  };

  const user = auth.session?.user;
  const email = user?.email ?? null;
  const testAccount = user?.app_metadata?.test_account === true && isTestEmail(email);
  const expiresAt = auth.session?.expires_at ?? null;
  const left = expiresAt ? expiresAt - Math.floor(now / 1000) : null;
  const routes = devAccountsAvailable();

  return (
    <View style={styles.wrap}>
      <Section title="Signed in as">
        <Info label="State" value={auth.status === 'member' ? `member${auth.profile ? ` · @${auth.profile.handle}` : ''}` : auth.status} />
        {user && (
          <>
            <Pressable
              onPress={() => Clipboard.setStringAsync(user.id).then(() => setNote({ text: 'User id copied' }))}
              accessibilityRole="button"
              accessibilityLabel="Copy user id"
            >
              <Info label="User id" value={`${user.id.slice(0, 8)}…  (tap to copy)`} />
            </Pressable>
            <Info label={usernameFromEmail(email) ? 'Username' : 'Email'} value={usernameFromEmail(email) ?? email ?? '—'} />
            <Info label="Provider" value={String(user.app_metadata?.provider ?? '—')} />
            <Info label="Anonymous" value={user.is_anonymous ? 'yes' : 'no'} />
            <Info label="Test account" value={testAccount ? 'yes' : 'no'} />
            <Info label="Access token" value={left === null ? '—' : left > 0 ? `expires in ${formatSecs(left)}` : 'expired'} />
          </>
        )}
        <Info
          label="Last event"
          value={auth.lastEvent ? `${auth.lastEvent.name} · ${formatSecs(Math.round((now - auth.lastEvent.at) / 1000))} ago` : '—'}
        />
      </Section>

      <Section title="Switch account" note={routes ? `Instant sign-in through ${devAuthUrl()}/dev/session. No password needed.` : 'Set EXPO_PUBLIC_DEV_AUTH_URL and run `npm run dev:auth`.'}>
        <View style={styles.chips}>
          <Chip label="Guest" on={auth.status === 'guest'} busy={busy === 'Sign out'} onPress={() => run('Sign out', async () => void (await signOut()))} />
          {TEST_ACCOUNTS.map((a) => (
            <Chip
              key={a}
              label={a}
              on={email === `dt-test+${a}@example.com`}
              busy={busy === a}
              disabled={!routes}
              onPress={() => run(a, () => devSignIn(a as TestAccount).then((e) => `Signed in as ${e}`))}
            />
          ))}
          <Chip label="+ New throwaway" busy={busy === 'fresh'} disabled={!routes} onPress={() => run('fresh', () => devSignIn('fresh').then((e) => `Signed in as ${e}`))} />
        </View>
      </Section>

      {testAccount && (
        <Section title="This test account">
          <Action label="Wipe my data" busy={busy === 'Wipe'} onPress={() => run('Wipe', async () => {
            await devWipe();
            // Reload the (now empty) saved state.
            reloadSocial();
            return 'Wiped all of this account’s likes, saves, reposts, sends, follows and comments';
          })} />
          {!['alice', 'bob', 'carol'].some((a) => email === `dt-test+${a}@example.com`) && (
            <Action label="Delete this account" tone="danger" busy={busy === 'Delete'} onPress={() => run('Delete', async () => {
              await devDeleteAccount();
              return 'Account deleted; you are a guest again';
            })} />
          )}
        </Section>
      )}

      {user && (
        <Section title="Simulate expiry" note="Best effort: edits supabase-js’s stored session, whose format is internal.">
          <Action label="Expire access token (silent refresh)" busy={busy === 'Expire'} onPress={() => run('Expire', expireAccessToken)} />
          <Action label="Break refresh token (forced sign-out)" tone="danger" busy={busy === 'Break'} onPress={() => run('Break', breakRefreshToken)} />
        </Section>
      )}

      {note && <Text style={[styles.note, note.error && styles.noteError]}>{note.text}</Text>}
    </View>
  );
}

// ---- expiry simulation ------------------------------------------------------------

function readStored(): Record<string, unknown> | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function writeStored(v: Record<string, unknown>) {
  globalThis.localStorage?.setItem(AUTH_STORAGE_KEY, JSON.stringify(v));
}

async function expireAccessToken(): Promise<string> {
  const stored = readStored();
  if (!stored || !supabase) throw new Error('no stored session');
  writeStored({ ...stored, expires_at: Math.floor(Date.now() / 1000) - 60 });
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const fresh = data.session?.expires_at ?? 0;
  return fresh > Date.now() / 1000 ? `Refreshed silently; new token expires in ${formatSecs(fresh - Math.floor(Date.now() / 1000))}` : 'Still expired?';
}

async function breakRefreshToken(): Promise<string> {
  const stored = readStored();
  if (!stored || !supabase) throw new Error('no stored session');
  writeStored({ ...stored, refresh_token: 'broken-refresh-token', expires_at: Math.floor(Date.now() / 1000) - 60 });
  const { error } = await supabase.auth.refreshSession();
  if (!error) return 'Refresh unexpectedly worked';
  // supabase-js signs out on a rejected refresh token; make sure either way.
  const { data } = await supabase.auth.getSession();
  if (data.session) await signOut();
  return `Refresh failed (${error.message}); signed out`;
}

// ---- bits ---------------------------------------------------------------------------

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function formatSecs(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {note ? <Text style={styles.groupNote}>{note}</Text> : null}
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Chip({ label, on, busy, disabled, onPress }: { label: string; on?: boolean; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, (pressed || busy || disabled) && styles.dim]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{busy ? '…' : label}</Text>
    </Pressable>
  );
}

function Action({ label, tone, busy, onPress }: { label: string; tone?: 'danger'; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.action, tone === 'danger' && styles.actionDanger, (pressed || busy) && styles.dim]}
      accessibilityRole="button"
    >
      <Text style={[styles.actionText, tone === 'danger' && styles.actionTextDanger]}>{busy ? '…' : label}</Text>
    </Pressable>
  );
}

const ACCENT = '#FFD60A';

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  group: { gap: 6 },
  groupTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  groupNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },
  rows: { gap: 8, marginTop: 4 },
  info: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  infoValue: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: '#eee', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#111' },
  action: { height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  actionDanger: { backgroundColor: 'rgba(255,69,58,0.14)' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionTextDanger: { color: '#ff6961' },
  dim: { opacity: 0.6 },
  note: { color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 16 },
  noteError: { color: '#ff6961' },
});
