import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { createSettingsStore, type DevSettings } from './settings';
import { devStorage } from './storage';

export const devSettings = createSettingsStore(devStorage);

/** The current dev settings; re-renders when any of them changes. */
export function useDevSettings(): DevSettings {
  return useSyncExternalStore(devSettings.subscribe, devSettings.getSnapshot, devSettings.getSnapshot);
}

/**
 * Whether the dev settings launcher shows: dev builds, and any web build
 * opened with `?dev` (as the landing's trial bar).
 */
export const DEV_TOOLS =
  __DEV__ || (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));

// ---- the panel's open state, so a clip's badge can open it on a tab ---------

export const DEV_TABS = ['interaction', 'model', 'panel'] as const;
export type DevTab = (typeof DEV_TABS)[number];

interface PanelState {
  open: boolean;
  tab: DevTab;
}

let panel: PanelState = { open: false, tab: 'interaction' };
const panelListeners = new Set<() => void>();

function setPanel(next: PanelState) {
  if (next.open === panel.open && next.tab === panel.tab) return;
  panel = next;
  panelListeners.forEach((l) => l());
}

export function openDevSettings(tab?: DevTab) {
  setPanel({ open: true, tab: tab ?? panel.tab });
}
export function closeDevSettings() {
  setPanel({ ...panel, open: false });
}
export function selectDevTab(tab: DevTab) {
  setPanel({ ...panel, tab });
}

function subscribePanel(l: () => void) {
  panelListeners.add(l);
  return () => {
    panelListeners.delete(l);
  };
}

export function useDevPanel(): PanelState {
  return useSyncExternalStore(subscribePanel, () => panel, () => panel);
}
