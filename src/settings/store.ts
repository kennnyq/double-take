import { useSyncExternalStore } from 'react';
import { createSettingsStore, type AppSettings } from './settings';
import { settingsStorage } from './storage';

export type { AppSettings, FeedMode } from './settings';

/** The app-wide settings store; changes apply everywhere immediately. */
export const appSettings = createSettingsStore(settingsStorage);

/** The current settings; re-renders when any of them changes. */
export function useAppSettings(): AppSettings {
  return useSyncExternalStore(appSettings.subscribe, appSettings.getSnapshot, appSettings.getSnapshot);
}

// ---- whether the Settings screen is open (the gear and the feed's empty state open it) ----

let open = false;
const openListeners = new Set<() => void>();

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  openListeners.forEach((l) => l());
}

export const openSettings = () => setOpen(true);
export const closeSettings = () => setOpen(false);

function subscribeOpen(l: () => void) {
  openListeners.add(l);
  return () => {
    openListeners.delete(l);
  };
}

export function useSettingsOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => open, () => open);
}
