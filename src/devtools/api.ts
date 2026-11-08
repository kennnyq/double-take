import { useLayoutEffect, useMemo, useSyncExternalStore, type DependencyList } from 'react';
import { createDevRegistry, resolveTabs, type DevChoiceItem, type DevChoiceRow, type DevSection, type DevSwitchRow, type ResolvedTab } from './registry';
import { DEFAULT_SETTINGS, type DevSettingKey, type DevSettings } from './settings';
import { devSettings, useDevSettings } from './store';

/**
 * The app's dev settings registry, bound to React. How to add a tab or a
 * section: see the top of `registry.ts`.
 */
export const devRegistry = createDevRegistry<DevSettings>();
export const registerDevTab = devRegistry.registerTab;
export const registerDevSection = devRegistry.registerSection;

export type DevSettingsSection = DevSection<DevSettings>;

/**
 * Shows a section while the calling component is mounted, made again when
 * `deps` change (as `useMemo`). Null shows nothing. Don't call it from a
 * component that also reads the registry, or each would re-render the other.
 */
export function useDevSection(make: () => DevSettingsSection | null, deps: DependencyList) {
  useLayoutEffect(() => {
    const section = make();
    return section ? registerDevSection(section) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The panel's tabs with their sections, for the current dev settings. */
export function useDevTabs(): ResolvedTab[] {
  const snap = useSyncExternalStore(devRegistry.subscribe, devRegistry.getSnapshot, devRegistry.getSnapshot);
  const s = useDevSettings();
  return useMemo(() => resolveTabs(snap, s), [snap, s]);
}

type KeysOf<T> = { [K in DevSettingKey]: DevSettings[K] extends T ? K : never }[DevSettingKey];

/** A choice row bound to a dev setting: its value, default and setter. */
export function settingChoice<K extends DevSettingKey>(
  s: DevSettings,
  key: K,
  label: string,
  items: readonly (DevChoiceItem & { value: DevSettings[K] })[],
  extra?: Partial<Pick<DevChoiceRow, 'display'>>,
): DevChoiceRow {
  return {
    kind: 'choice',
    id: key,
    label,
    items,
    value: s[key] as DevChoiceRow['value'],
    defaultValue: DEFAULT_SETTINGS[key] as DevChoiceRow['value'],
    onSelect: (value) => devSettings.set({ [key]: value } as Partial<DevSettings>),
    ...extra,
  };
}

/** An on/off row bound to a boolean dev setting. */
export function settingSwitch<K extends KeysOf<boolean>>(s: DevSettings, key: K, label: string, note?: string): DevSwitchRow {
  return {
    kind: 'switch',
    id: key,
    label,
    note,
    value: s[key] as boolean,
    defaultValue: DEFAULT_SETTINGS[key] as boolean,
    onChange: (value) => devSettings.set({ [key]: value } as Partial<DevSettings>),
  };
}
