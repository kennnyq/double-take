/**
 * The viewer's app settings: a schema of defaults and validators, and a small
 * store that persists them as one JSON blob. No React Native imports, so it
 * runs under `node --test`.
 *
 * Adding a setting: add it to `AppSettings` and `SCHEMA`. Saved blobs from
 * older builds still load; missing or invalid keys fall back to their default.
 */

/** How the feed treats each clip's AI verdict. */
export const FEED_MODES = ['default', 'autoLabel', 'onlyAi', 'onlyReal'] as const;
export type FeedMode = (typeof FEED_MODES)[number];

export interface AppSettings {
  feedMode: FeedMode;
}

interface Field<T> {
  default: T;
  valid: (v: unknown) => v is T;
}

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);

export const SCHEMA: { [K in keyof AppSettings]: Field<AppSettings[K]> } = {
  feedMode: { default: 'default', valid: oneOf(FEED_MODES) },
};

export const DEFAULT_SETTINGS: AppSettings = Object.freeze(
  Object.fromEntries(Object.entries(SCHEMA).map(([k, f]) => [k, f.default])) as unknown as AppSettings,
);

/** Where the blob lives: `localStorage` on web, SQLite's key-value store on devices. */
export const STORAGE_KEY = 'double-take.settings.v1';

/** The subset of `localStorage` (and expo-sqlite's kv-store) the store needs. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parse a saved blob, keeping only known, valid keys. Never throws. */
export function readSettings(raw: string | null | undefined): AppSettings {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt blob: start from the defaults.
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SCHEMA) as [keyof AppSettings, Field<unknown>][]) {
    out[key] = field.valid(saved[key]) ? saved[key] : field.default;
  }
  return out as unknown as AppSettings;
}

export interface SettingsStore {
  getSnapshot: () => AppSettings;
  subscribe: (listener: () => void) => () => void;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

/**
 * A store for `useSyncExternalStore`. Reads `storage` once, then writes through
 * on every change; with no storage (or a failing one) settings last the session.
 */
export function createSettingsStore(storage: KeyValue | null): SettingsStore {
  let current = readSettings(safe(() => storage?.getItem(STORAGE_KEY) ?? null, null));
  const listeners = new Set<() => void>();

  const commit = (next: AppSettings) => {
    current = next;
    safe(() => storage?.setItem(STORAGE_KEY, JSON.stringify(next)), undefined);
    listeners.forEach((l) => l());
  };

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (key, value) => {
      if (!SCHEMA[key].valid(value) || current[key] === value) return;
      commit({ ...current, [key]: value });
    },
    reset: () => commit({ ...DEFAULT_SETTINGS }),
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
