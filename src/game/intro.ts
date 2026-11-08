import { useSyncExternalStore } from 'react';
import { settingsStorage } from '@/settings/storage';

/**
 * The Game tab's first-run intro (how to call AI and how to say real): shown
 * once on this device, kept with the app settings like the gesture hint's
 * progress, and reset from Dev settings → Game.
 */
const KEY = 'double-take.game-intro.v1';

function read(): boolean {
  try {
    return settingsStorage?.getItem(KEY) === 'seen';
  } catch {
    return false;
  }
}

let seen = read();
const listeners = new Set<() => void>();

function set(next: boolean) {
  seen = next;
  try {
    settingsStorage?.setItem(KEY, next ? 'seen' : '');
  } catch {
    // Not kept: it shows again next time.
  }
  for (const l of listeners) l();
}

export const gameIntro = {
  getSnapshot: () => seen,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  done: () => set(true),
  reset: () => set(false),
};

export function useGameIntroSeen(): boolean {
  return useSyncExternalStore(gameIntro.subscribe, gameIntro.getSnapshot, gameIntro.getSnapshot);
}
