import { useSyncExternalStore } from 'react';
import { settingsStorage } from '@/settings/storage';

/**
 * "Continue as guest": a signed-out viewer who chose to use the app without an
 * account. Guests can do everything members can, but it's kept on this device
 * only (see `src/social/localSocial.ts`). The choice is remembered across
 * reloads; signing out of an account clears it, back to the choice.
 */
const KEY = 'double-take.guest.v1';

function read(): boolean {
  try {
    return settingsStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let chosen = read();
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === chosen) return;
  chosen = next;
  try {
    if (next) settingsStorage?.setItem(KEY, '1');
    else settingsStorage?.setItem(KEY, '0');
  } catch {
    // Blocked storage: the choice lasts this session.
  }
  listeners.forEach((l) => l());
}

export const guestStore = {
  getSnapshot: () => chosen,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Whether the viewer chose to continue as a guest. */
export const isGuestChosen = () => chosen;
export const continueAsGuest = () => set(true);
export const forgetGuestChoice = () => set(false);

export function useGuestChosen(): boolean {
  return useSyncExternalStore(guestStore.subscribe, guestStore.getSnapshot, guestStore.getSnapshot);
}

/** How a guest appears on their own profile and comments: a local placeholder. */
export const GUEST_ME = { handle: 'guest', name: 'Guest' } as const;
