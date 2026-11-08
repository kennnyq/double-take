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

/**
 * How a clip's double take (its tells walkthrough) opens, besides its button:
 * hold (long-press on phones, holding Space on desktop), double tap
 * (double-click on desktop), or either.
 */
export const REVEAL_GESTURES = ['hold', 'doubleTap', 'both'] as const;
export type RevealGesture = (typeof REVEAL_GESTURES)[number];

export interface AppSettings {
  feedMode: FeedMode;
  revealGesture: RevealGesture;
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
  revealGesture: { default: 'hold', valid: oneOf(REVEAL_GESTURES) },
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

/**
 * The dev settings' blob. The double take's gesture used to be a dev setting;
 * a saved pick there carries over until the viewer picks one here.
 */
export const LEGACY_DEV_STORAGE_KEY = 'double-take:dev-settings:v1';

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Corrupt blob: start from the defaults.
  }
  return {};
}

/**
 * Parse a saved blob, keeping only known, valid keys. Never throws. `legacyDev`
 * is the dev settings' blob, read only for a gesture this blob doesn't have yet.
 */
export function readSettings(raw: string | null | undefined, legacyDev?: string | null): AppSettings {
  const saved = parseObject(raw);
  if (!SCHEMA.revealGesture.valid(saved.revealGesture) && legacyDev) {
    const legacy = parseObject(legacyDev).revealGesture;
    if (SCHEMA.revealGesture.valid(legacy)) saved.revealGesture = legacy;
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
  const raw = safe(() => storage?.getItem(STORAGE_KEY) ?? null, null);
  let current = readSettings(raw, safe(() => storage?.getItem(LEGACY_DEV_STORAGE_KEY) ?? null, null));
  const listeners = new Set<() => void>();
  // A gesture carried over from the dev settings is saved here at once: the dev
  // blob drops it the next time a dev setting changes.
  if (!SCHEMA.revealGesture.valid(parseObject(raw).revealGesture) && current.revealGesture !== DEFAULT_SETTINGS.revealGesture) {
    safe(() => storage?.setItem(STORAGE_KEY, JSON.stringify(current)), undefined);
  }

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
