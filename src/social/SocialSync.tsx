import { useEffect, useSyncExternalStore } from 'react';
import { authGate } from '@/auth/gate';
import { authStore, type AuthState } from '@/auth/store';
import { supabase } from '@/auth/supabase';
import { loadInitialClips } from '@/data/feed';
import { clipKey, isPersistable } from './clipRefs';
import { clearPendingWrites } from './persist';
import { useSocialStore } from './store';
import { clipsByKey, fetchMine, fetchStats, othersCounts, toSocialState } from './sync';

/** Whose saved state is loaded: a user id, 'guest', or null while loading. */
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

/** Whose saved state is in the social store ('guest', a user id, or null while loading). */
export function useLoadedFor(): string | null {
  return useSyncExternalStore(subscribe, () => loadedFor, () => loadedFor);
}

let reload: (() => void) | null = null;

/** Load the current account's saved state again (e.g. after a dev wipe). */
export const reloadSocial = () => reload?.();

const who = (s: AuthState) => (s.status === 'member' ? s.session!.user.id : s.status === 'guest' ? 'guest' : null);

/**
 * Keeps the social store in step with the account: on sign-in it loads the
 * user's saved state (then runs the action that asked them to sign in); on
 * sign-out it clears it. Either way it loads everyone's public counts.
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
        if (target === 'guest') {
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
      // Signed in from the gate: now the pending action runs, against the real state.
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
    onAuth();
    const unsubscribe = authStore.subscribe(onAuth);
    return () => {
      reload = null;
      unsubscribe();
    };
  }, [store]);

  return null;
}
