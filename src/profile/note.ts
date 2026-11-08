import { useSyncExternalStore } from 'react';
import { authStore, saveMemberNote, useAuth } from '@/auth/store';
import { settingsStorage } from '@/settings/storage';
import { normalizeNote } from './noteText';

/**
 * Your profile note. Members keep it on their Supabase profile; guests (and
 * local mode) keep it on this device.
 */
const KEY = 'double-take.note.v1';

function read(): string | null {
  try {
    return normalizeNote(settingsStorage?.getItem(KEY));
  } catch {
    return null;
  }
}

let localNote = read();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useMyNote(): string | null {
  const { status, profile } = useAuth();
  const local = useSyncExternalStore(subscribe, () => localNote, () => localNote);
  return status === 'member' ? (profile?.note ?? null) : local;
}

/** Save a note (empty clears it). Returns whether it was saved. */
export async function setMyNote(raw: string): Promise<boolean> {
  const note = normalizeNote(raw);
  if (authStore.getState().status === 'member') return saveMemberNote(note);
  localNote = note;
  try {
    settingsStorage?.setItem(KEY, note ?? '');
  } catch {
    // Blocked storage: it lasts this session.
  }
  listeners.forEach((l) => l());
  return true;
}
