/**
 * The dev settings registry: which tabs the panel has and what each holds.
 * Pure (no React Native), so it runs under `node --test`; `api.ts` binds one
 * registry to React, and `builtins.tsx` registers the built-in tabs.
 *
 * Adding a section
 * ----------------
 * A section is a titled block of rows on a tab. Register it once at module
 * level, reading the dev settings it shows from `s`:
 *
 *   registerDevSection({
 *     id: 'double-take',             // unique; registering the id again replaces it
 *     tab: 'interaction',            // a built-in tab, or one from registerDevTab()
 *     title: 'Double take',
 *     rows: (s) => [settingChoice(s, 'myKey', 'My setting', [{ label: 'A', value: 'a' }, …])],
 *   });
 *
 * (Add `myKey` to `DevSettings`, `DEFAULT_SETTINGS` and `parseSettings` in
 * `settings.ts` first.) A component with live state of its own registers with
 * `useDevSection(() => ({ …, rows: [...] }), [deps])` instead, and a section
 * that needs a view of its own sets `Component`. A new tab:
 * `registerDevTab({ id: 'flows', label: 'Flows', icon: 'git-branch-outline', order: 25 })`;
 * a tab with no sections is hidden.
 */
import type { ComponentType } from 'react';

// ---- rows -------------------------------------------------------------------

export type DevValue = string | number;

export interface DevChoiceItem {
  label: string;
  value: DevValue;
  /** A short line under the row while this item is picked. */
  note?: string;
}

/** One of several values. Shown as chips when they fit, else as a ‹ value › stepper. */
export interface DevChoiceRow {
  kind: 'choice';
  /** Stable within its section; defaults to the label. Used to pin the row to the launcher. */
  id?: string;
  label: string;
  items: readonly DevChoiceItem[];
  value: DevValue;
  /** Marks the default item, counts the row as changed and lets Reset put it back. */
  defaultValue?: DevValue;
  onSelect(value: DevValue): void;
  display?: 'chips' | 'stepper';
}

export interface DevSwitchRow {
  kind: 'switch';
  id?: string;
  label: string;
  value: boolean;
  defaultValue?: boolean;
  onChange(value: boolean): void;
  note?: string;
}

/** A button: a UI flow to jump into, or a tool. */
export interface DevActionRow {
  kind: 'action';
  id?: string;
  label: string;
  note?: string;
  /** Red, for one that throws something away. */
  tone?: 'danger';
  run(): void;
}

export type DevRow = DevChoiceRow | DevSwitchRow | DevActionRow;

// ---- tabs and sections ----------------------------------------------------------

export interface DevTabDef {
  id: string;
  label: string;
  /** An Ionicons name. */
  icon: string;
  /** Lower first. Built-ins use 10, 20, 30, …, so a tab can slot in between. */
  order: number;
}

export interface DevSection<C> {
  id: string;
  tab: string;
  /** Leave out for a `Component` that titles itself. */
  title?: string;
  note?: string;
  /** Lower first within the tab; then in the order they registered. */
  order?: number;
  rows?: readonly DevRow[] | ((ctx: C) => readonly DevRow[]);
  /** A view of its own, below the rows (e.g. the Accounts tab). */
  Component?: ComponentType;
  /** Extra words for the search to match. */
  keywords?: string;
}

/** A section with its rows worked out for the current settings. */
export interface ResolvedSection {
  id: string;
  tab: string;
  title?: string;
  note?: string;
  rows: readonly DevRow[];
  Component?: ComponentType;
  keywords?: string;
}

export interface ResolvedTab extends DevTabDef {
  sections: ResolvedSection[];
  /** How many rows on it differ from their defaults. */
  changed: number;
}

export interface RegistrySnapshot<C> {
  tabs: readonly DevTabDef[];
  sections: readonly DevSection<C>[];
}

export interface DevRegistry<C> {
  registerTab(tab: DevTabDef): () => void;
  registerSection(section: DevSection<C>): () => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RegistrySnapshot<C>;
}

export function createDevRegistry<C>(): DevRegistry<C> {
  type Entry<T> = { value: T; serial: number };
  const tabs = new Map<string, Entry<DevTabDef>>();
  const sections = new Map<string, Entry<DevSection<C>>>();
  const listeners = new Set<() => void>();
  let serial = 0;
  let snapshot: RegistrySnapshot<C> = { tabs: [], sections: [] };

  const publish = () => {
    snapshot = {
      tabs: [...tabs.values()].sort((a, b) => a.value.order - b.value.order || a.serial - b.serial).map((e) => e.value),
      sections: [...sections.values()]
        .sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0) || a.serial - b.serial)
        .map((e) => e.value),
    };
    listeners.forEach((l) => l());
  };

  // Registering an id again replaces it in place. The returned cleanup removes
  // it only if it's still this registration, and a moment later, so a
  // component that re-registers on each render doesn't flicker out between.
  function register<T>(map: Map<string, Entry<T>>, id: string, value: T): () => void {
    const entry = { value, serial: map.get(id)?.serial ?? serial++ };
    map.set(id, entry);
    publish();
    return () => {
      queueMicrotask(() => {
        if (map.get(id) !== entry) return;
        map.delete(id);
        publish();
      });
    };
  }

  return {
    registerTab: (tab) => register(tabs, tab.id, tab),
    registerSection: (section) => register(sections, section.id, section),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}

// ---- working out what the panel shows ---------------------------------------------

export function resolveSection<C>(section: DevSection<C>, ctx: C): ResolvedSection {
  const rows = typeof section.rows === 'function' ? section.rows(ctx) : (section.rows ?? []);
  return { ...section, rows };
}

/** The tabs that have something on them, in order, each with its sections. */
export function resolveTabs<C>(snap: RegistrySnapshot<C>, ctx: C): ResolvedTab[] {
  return snap.tabs
    .map((tab) => {
      const sections = snap.sections.filter((s) => s.tab === tab.id).map((s) => resolveSection(s, ctx));
      return { ...tab, sections, changed: countChanged(sections.flatMap((s) => s.rows)) };
    })
    .filter((t) => t.sections.some((s) => s.rows.length > 0 || s.Component));
}

export function rowKey(sectionId: string, row: DevRow): string {
  return `${sectionId}/${row.id ?? row.label}`;
}

/** Whether a row's value differs from its default (rows without a default never do). */
export function rowChanged(row: DevRow): boolean {
  if (row.kind === 'action' || row.defaultValue === undefined) return false;
  return row.value !== row.defaultValue;
}

export function countChanged(rows: readonly DevRow[]): number {
  return rows.filter(rowChanged).length;
}

/** Puts the rows back to their defaults. */
export function resetRows(rows: readonly DevRow[]): void {
  for (const row of rows) {
    if (!rowChanged(row)) continue;
    if (row.kind === 'choice') row.onSelect(row.defaultValue!);
    else if (row.kind === 'switch') row.onChange(row.defaultValue!);
  }
}

/** The value `dir` steps from `value`, wrapping round at either end (as the landing's trial bar). */
export function stepValue(items: readonly DevChoiceItem[], value: DevValue, dir: 1 | -1): DevValue {
  if (items.length === 0) return value;
  const i = items.findIndex((it) => it.value === value);
  if (i < 0) return items[dir === 1 ? 0 : items.length - 1].value;
  return items[(i + dir + items.length) % items.length].value;
}

/** Chips for a few short choices; a ‹ value › stepper for more, or longer ones. */
export function choiceDisplay(row: DevChoiceRow): 'chips' | 'stepper' {
  if (row.display) return row.display;
  const chars = row.items.reduce((n, it) => n + it.label.length, 0);
  return row.items.length <= 4 && chars <= 28 ? 'chips' : 'stepper';
}

/** Finds a row by `rowKey`, with its section, across the tabs. */
export function findRow(tabs: readonly ResolvedTab[], key: string): { tab: ResolvedTab; section: ResolvedSection; row: DevRow } | null {
  for (const tab of tabs)
    for (const section of tab.sections)
      for (const row of section.rows) if (rowKey(section.id, row) === key) return { tab, section, row };
  return null;
}

export interface SearchHit {
  tab: ResolvedTab;
  section: ResolvedSection;
  /** The rows that match; all of them when the section's title or keywords do. */
  rows: readonly DevRow[];
}

/** Every section with something the query names; each word must appear. */
export function searchTabs(tabs: readonly ResolvedTab[], query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const hits: SearchHit[] = [];
  for (const tab of tabs) {
    for (const section of tab.sections) {
      const head = [tab.label, section.title ?? '', section.note ?? '', section.keywords ?? ''].join(' ');
      if (has(head)) {
        hits.push({ tab, section, rows: section.rows });
        continue;
      }
      const rows = section.rows.filter((r) => has(`${head} ${rowText(r)}`));
      if (rows.length) hits.push({ tab, section, rows });
    }
  }
  return hits;
}

function rowText(row: DevRow): string {
  const parts = [row.label];
  if (row.kind === 'choice') parts.push(...row.items.map((i) => i.label));
  if (row.kind !== 'choice' && row.note) parts.push(row.note);
  return parts.join(' ');
}
