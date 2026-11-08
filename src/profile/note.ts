import { useSyncExternalStore } from 'react';
import { authStore, useAuth, type AuthState } from '@/auth/store';
import { settingsStorage } from '@/settings/storage';
import { normalizeNote } from './noteText';

/**
 * Your profile note, kept on this device for everyone for now. Each signed-in
 * account has its own, so accounts sharing a device don't share a note;
 * guests (and local mode) share the device's one.
 * (`profiles.note` exists in the database but isn't used yet.)
 */
const KEY = 'double-take.note.v1';

const keyFor = (s: Pick<AuthState, 'status' | 'session'>) =>
  s.status === 'member' && s.session ? `${KEY}:${s.session.user.id}` : KEY;

/** Notes read so far, by storage key, so snapshots stay stable between renders. */
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function read(key: string): string | null {
  if (!cache.has(key)) {
    let v: string | null = null;
    try {
      v = normalizeNote(settingsStorage?.getItem(key));
    } catch {
      // Blocked storage: no note.
    }
    cache.set(key, v);
  }
  return cache.get(key) ?? null;
}

export function useMyNote(): string | null {
  const key = keyFor(useAuth());
  return useSyncExternalStore(subscribe, () => read(key), () => read(key));
}

/** Save a note for whoever is signed in (empty clears it). */
export function setMyNote(raw: string) {
  const key = keyFor(authStore.getState());
  const note = normalizeNote(raw);
  cache.set(key, note);
  try {
    settingsStorage?.setItem(key, note ?? '');
  } catch {
    // Blocked storage: it lasts this session.
  }
  listeners.forEach((l) => l());
}
