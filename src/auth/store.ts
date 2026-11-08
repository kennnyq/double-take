import { useEffect, useSyncExternalStore } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { ME } from '@/social/me';
import { forgetGuestChoice, GUEST_ME, useGuestChosen } from './guest';
import { isMember } from './member';
import { supabase } from './supabase';
import { usernameFromEmail } from './username';

/**
 * - local: no Supabase configured; actions stay in memory and nothing is gated
 * - loading: reading the stored session
 * - guest: signed out. Watches only, unless they chose "Continue as guest"
 *   (`guest.ts`): then they act too, saved on this device only
 * - member: signed in
 */
export type AuthStatus = 'local' | 'loading' | 'guest' | 'member';

export interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
  /** The profile note (the bubble over the avatar), or null. */
  note: string | null;
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
  const { data, error } = await supabase.from('profiles').select('id, handle, display_name, note').eq('id', userId).maybeSingle();
  if (error) console.warn(`[auth] profile: ${error.message}`);
  // Ignore a late answer for someone who has since signed out or switched.
  if (currentUserId() !== userId) return;
  set({ profile: data ? { id: data.id, handle: data.handle, displayName: data.display_name, note: data.note ?? null } : null });
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

/** Sign out; a guest choice is forgotten too, so it's back to sign in or guest. */
export async function signOut() {
  forgetGuestChoice();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    console.warn(`[auth] sign out: ${error.message}`);
    // The local session is cleared even when the server call fails; follow it.
    apply(null, 'SIGNED_OUT');
  }
}

/**
 * Set the signed-in member's note: shown at once, saved to their profile, and
 * put back if saving fails. Returns whether it saved.
 */
export async function saveMemberNote(note: string | null): Promise<boolean> {
  const id = currentUserId();
  const before = state.profile;
  if (!supabase || !id || !before) return false;
  set({ profile: { ...before, note } });
  const { error } = await supabase.from('profiles').update({ note }).eq('id', id);
  if (!error) return true;
  console.warn(`[auth] note: ${error.message}`);
  if (currentUserId() === id) set({ profile: { ...(state.profile ?? before), note: before.note } });
  return false;
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
 * while it loads, a guest placeholder, or the local mock when no Supabase is
 * configured.
 */
export function useMe(): { handle: string; name: string } {
  const { status, profile, session } = useAuth();
  const guest = useGuestChosen();
  if (status === 'local') return { handle: ME.handle, name: ME.name };
  if (status === 'guest' && guest) return { ...GUEST_ME };
  if (profile) return { handle: profile.handle, name: profile.displayName ?? profile.handle };
  const local = usernameFromEmail(session?.user.email) ?? session?.user.email?.split('@')[0] ?? 'you';
  return { handle: local, name: local };
}
