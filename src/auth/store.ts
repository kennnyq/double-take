import { useEffect, useSyncExternalStore } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { ME } from '@/social/me';
import { isMember } from './member';
import { supabase } from './supabase';

/**
 * - local: no Supabase configured; actions stay in memory and nothing is gated
 * - loading: reading the stored session
 * - guest: signed out; can watch, not act
 * - member: signed in
 */
export type AuthStatus = 'local' | 'loading' | 'guest' | 'member';

export interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
}

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  /** The last auth event and when (for the dev Accounts tab). */
  lastEvent: { name: AuthChangeEvent | 'INITIAL'; at: number } | null;
}

let state: AuthState = {
  status: supabase ? 'loading' : 'local',
  session: null,
  profile: null,
  lastEvent: null,
};
const listeners = new Set<() => void>();

function set(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const authStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** The signed-in user's id, or null for guests and local mode. */
export const currentUserId = () => (state.status === 'member' ? (state.session?.user.id ?? null) : null);

async function loadProfile(userId: string) {
  if (!supabase) return;
  const { data, error } = await supabase.from('profiles').select('id, handle, display_name').eq('id', userId).maybeSingle();
  if (error) console.warn(`[auth] profile: ${error.message}`);
  // Ignore a late answer for someone who has since signed out or switched.
  if (currentUserId() !== userId) return;
  set({ profile: data ? { id: data.id, handle: data.handle, displayName: data.display_name } : null });
}

function apply(session: Session | null, event: AuthChangeEvent | 'INITIAL') {
  const member = isMember(session);
  const prevId = currentUserId();
  set({
    status: member ? 'member' : 'guest',
    session: member ? session : null,
    profile: member && prevId === session!.user.id ? state.profile : null,
    lastEvent: { name: event, at: Date.now() },
  });
  if (member && (prevId !== session!.user.id || !state.profile)) loadProfile(session!.user.id);
}

let started = false;

/** Read the stored session and follow auth changes. Idempotent. */
export function startAuth() {
  if (started || !supabase) return;
  started = true;
  const client = supabase;
  client.auth.getSession().then(({ data }) => {
    // onAuthStateChange may already have reported a newer session.
    if (state.status === 'loading') apply(data.session, 'INITIAL');
  });
  client.auth.onAuthStateChange((event, session) => {
    // Callbacks must not await Supabase calls (they'd deadlock), so defer the work.
    setTimeout(() => apply(session, event), 0);
  });
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    console.warn(`[auth] sign out: ${error.message}`);
    // The local session is cleared even when the server call fails; follow it.
    apply(null, 'SIGNED_OUT');
  }
}

export function refreshProfile() {
  const id = currentUserId();
  if (id) loadProfile(id);
}

/** Current auth state; re-renders when it changes. */
export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
}

/** Starts auth for the app; render once near the root. */
export function AuthBoot() {
  useEffect(startAuth, []);
  return null;
}

/**
 * The handle and name to show for "you": the member's profile, a stand-in
 * while it loads, or the local mock when no Supabase is configured.
 */
export function useMe(): { handle: string; name: string } {
  const { status, profile, session } = useAuth();
  if (status === 'local') return { handle: ME.handle, name: ME.name };
  if (profile) return { handle: profile.handle, name: profile.displayName ?? profile.handle };
  const local = session?.user.email?.split('@')[0] ?? 'you';
  return { handle: local, name: local };
}
