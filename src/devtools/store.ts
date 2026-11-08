import { useSyncExternalStore } from 'react';
import { createSettingsStore, type DevSettings } from './settings';
import { devStorage } from './storage';

export const devSettings = createSettingsStore(devStorage);

/** The current dev settings; re-renders when any of them changes. */
export function useDevSettings(): DevSettings {
  return useSyncExternalStore(devSettings.subscribe, devSettings.getSnapshot, devSettings.getSnapshot);
}

/** Whether the dev settings show: dev builds only, never production. */
export const DEV_TOOLS = __DEV__;

// ---- the panel's open state and tab, so a clip's badge can open it on a tab ----------

/** The built-in tabs (`builtins.tsx`); others come from `registerDevTab`. */
export const BUILT_IN_TABS = ['interaction', 'model', 'colors', 'flows', 'accounts', 'panel'] as const;
export type DevTab = (typeof BUILT_IN_TABS)[number] | (string & {});
/** @deprecated The panel's tabs now come from the registry (`useDevTabs`); kept for callers of the old API. */
export const DEV_TABS: readonly DevTab[] = BUILT_IN_TABS;

interface PanelState {
  open: boolean;
  tab: DevTab;
}

const TAB_KEY = 'double-take:dev-tab:v1';
const PIN_KEY = 'double-take:dev-pin:v1';

function load(key: string): string | null {
  try {
    return devStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    devStorage?.setItem(key, value);
  } catch {
    // Not kept; it still applies for this session.
  }
}

let panel: PanelState = { open: false, tab: (DEV_TOOLS && load(TAB_KEY)) || 'interaction' };
const panelListeners = new Set<() => void>();

function setPanel(next: PanelState) {
  if (next.open === panel.open && next.tab === panel.tab) return;
  if (next.tab !== panel.tab) save(TAB_KEY, next.tab);
  panel = next;
  panelListeners.forEach((l) => l());
}

export function openDevSettings(tab?: DevTab) {
  setPanel({ open: true, tab: tab ?? panel.tab });
}
export function closeDevSettings() {
  setPanel({ ...panel, open: false });
}
export function toggleDevSettings() {
  setPanel({ ...panel, open: !panel.open });
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

// ---- the row pinned to the launcher, to step through without opening the panel -------

let pinned: string | null = DEV_TOOLS ? load(PIN_KEY) || null : null;
const pinListeners = new Set<() => void>();

/** Pins a choice row (by `rowKey`) to the launcher, or unpins with null. */
export function pinDevRow(key: string | null) {
  if (key === pinned) return;
  pinned = key;
  save(PIN_KEY, key ?? '');
  pinListeners.forEach((l) => l());
}

function subscribePin(l: () => void) {
  pinListeners.add(l);
  return () => {
    pinListeners.delete(l);
  };
}

export function usePinnedRow(): string | null {
  return useSyncExternalStore(subscribePin, () => pinned, () => pinned);
}
