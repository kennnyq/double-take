import { useEffect, useSyncExternalStore } from 'react';
import { authGate } from '@/auth/gate';
import { guestStore, isGuestChosen } from '@/auth/guest';
import { authStore, type AuthState } from '@/auth/store';
import { supabase } from '@/auth/supabase';
import { loadInitialClips } from '@/data/feed';
import { clipKey, isPersistable } from './clipRefs';
import { clearPendingWrites } from './persist';
import { useSocialStore } from './store';
import { readLocalRows, writeLocalRows } from './localSocial';
import { clipsByKey, fetchMine, fetchStats, othersCounts, toSocialState } from './sync';

/** Whose saved state is loaded: a user id, 'local' (a guest's, on this device), 'guest' (none), or null while loading. */
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
function setLoadedFor(v: string | null) {
  if (v === loadedFor) return;
  loadedFor = v;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Whose saved state is in the social store (see `loadedFor`). */
export function useLoadedFor(): string | null {
  return useSyncExternalStore(subscribe, () => loadedFor, () => loadedFor);
}

let reload: (() => void) | null = null;

/** Load the current account's saved state again (e.g. after a dev wipe). */
export const reloadSocial = () => reload?.();

const who = (s: AuthState) =>
  s.status === 'member' ? s.session!.user.id : s.status === 'guest' ? (isGuestChosen() ? 'local' : 'guest') : null;

/** A guest's changes are written to the device this long after the last one, ms. */
const SAVE_DELAY_MS = 300;

/**
 * Keeps the social store in step with the account: on sign-in it loads the
 * user's saved state (then runs the action that asked them to sign in); on
 * sign-out it clears it. A guest who chose to continue without an account gets
 * their state from the device, and every change is saved back there. Either
 * way it loads everyone's public counts.
 * Renders nothing; does nothing in local mode.
 */
export function SocialSync() {
  const store = useSocialStore();

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let current: string | null = null;
    let generation = 0;

    const load = async (target: string) => {
      const gen = ++generation;
      setLoadedFor(null);
      clearPendingWrites();
      store.dispatch({ type: 'reset' });
      try {
        const clips = await loadInitialClips();
        const keys = clips.filter(isPersistable).map(clipKey);
        if (target === 'local') {
          // The guest's own state first, so it shows even when Supabase can't be reached.
          store.dispatch({ type: 'hydrate', state: toSocialState(readLocalRows(), clipsByKey(clips)) });
          const stats = await fetchStats(client, keys);
          if (gen !== generation) return;
          store.dispatch({ type: 'stats', stats: othersCounts(stats) });
        } else if (target === 'guest') {
          const stats = await fetchStats(client, keys);
          if (gen !== generation) return;
          store.dispatch({ type: 'stats', stats: othersCounts(stats) });
        } else {
          const [mine, stats] = await Promise.all([fetchMine(client, target), fetchStats(client, keys)]);
          if (gen !== generation) return;
          store.dispatch({ type: 'hydrate', state: toSocialState(mine, clipsByKey(clips), stats) });
        }
      } catch (e) {
        // Paused project or offline: carry on with the stand-in counts only.
        console.warn(`[social] couldn't load saved state: ${e instanceof Error ? e.message : e}`);
      }
      if (gen !== generation) return;
      setLoadedFor(target);
      // Signed in (or chose guest) from the gate: now the pending action runs, against the real state.
      if (target !== 'guest' && authGate.getSnapshot().open) authGate.ready();
    };

    const onAuth = () => {
      const target = who(authStore.getState());
      if (target === current || target === null) return;
      current = target;
      load(target);
    };
    reload = () => {
      if (current) load(current);
    };
    // A guest's state is written to the device, a moment after each change.
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      saveTimer = null;
      if (current === 'local' && loadedFor === 'local') writeLocalRows(store.getState());
    };
    const unsubscribeStore = store.subscribe(() => {
      if (current !== 'local' || loadedFor !== 'local') return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_DELAY_MS);
    });

    onAuth();
    const unsubscribe = authStore.subscribe(onAuth);
    const unsubscribeGuest = guestStore.subscribe(onAuth);
    return () => {
      reload = null;
      if (saveTimer) clearTimeout(saveTimer);
      save();
      unsubscribe();
      unsubscribeGuest();
      unsubscribeStore();
    };
  }, [store]);

  return null;
}
