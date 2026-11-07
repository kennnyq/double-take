/**
 * Dev settings: the choices on trial, their defaults and a small store that
 * keeps them in a key-value storage. Pure (no React Native), so it runs under
 * `node --test`; `store.ts` binds it to the device's storage and React.
 */

/** How the double take (the tells walkthrough) is started on a clip. */
export const REVEAL_GESTURES = ['hold', 'doubleTap'] as const;
export type RevealGesture = (typeof REVEAL_GESTURES)[number];

/** How long a press must last to count as a hold, in ms. */
export const HOLD_DELAYS = [250, 350, 500] as const;
export type HoldDelay = (typeof HOLD_DELAYS)[number];

/** Where the dev settings launcher floats; `auto` picks a free spot for the layout. */
export const LAUNCHER_CORNERS = ['auto', 'topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const;
export type LauncherCorner = (typeof LAUNCHER_CORNERS)[number];

/** The published tells file; alternatives are named after their pipeline (e.g. `claude`). */
export const MAIN_PIPELINE = 'main';

export interface DevSettings {
  revealGesture: RevealGesture;
  holdMs: HoldDelay;
  /** A small "Hold for a double take" hint on clips that have tells. */
  gestureHint: boolean;
  /** The tells pipeline ("model") every clip shows; clips without it fall back to main. */
  pipeline: string;
  /** Show which pipeline a clip's tells come from, at its top right. */
  pipelineBadge: boolean;
  launcher: LauncherCorner;
}

export type DevSettingKey = keyof DevSettings;

export const DEFAULT_SETTINGS: Readonly<DevSettings> = Object.freeze({
  revealGesture: 'hold',
  holdMs: 350,
  gestureHint: true,
  pipeline: MAIN_PIPELINE,
  pipelineBadge: true,
  launcher: 'auto',
});

export const STORAGE_KEY = 'double-take:dev-settings:v1';

function oneOf<T>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

/** Settings from stored JSON; anything missing or malformed takes its default. */
export function parseSettings(raw: string | null | undefined): DevSettings {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // Corrupt storage: start over from the defaults.
  }
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    revealGesture: oneOf(REVEAL_GESTURES, o.revealGesture, d.revealGesture),
    holdMs: oneOf(HOLD_DELAYS, o.holdMs, d.holdMs),
    gestureHint: bool(o.gestureHint, d.gestureHint),
    pipeline: typeof o.pipeline === 'string' && /^[\w.-]{1,40}$/.test(o.pipeline) ? o.pipeline : d.pipeline,
    pipelineBadge: bool(o.pipelineBadge, d.pipelineBadge),
    launcher: oneOf(LAUNCHER_CORNERS, o.launcher, d.launcher),
  };
}

/** The settings that differ from their defaults. */
export function changedKeys(s: DevSettings): DevSettingKey[] {
  return (Object.keys(DEFAULT_SETTINGS) as DevSettingKey[]).filter((k) => s[k] !== DEFAULT_SETTINGS[k]);
}

/** Synchronous key-value storage: `localStorage` on web, SQLite's kv-store on devices. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStore {
  getSnapshot(): DevSettings;
  subscribe(listener: () => void): () => void;
  set(patch: Partial<DevSettings>): void;
  /** Back to the defaults: the given keys, or all of them. */
  reset(keys?: readonly DevSettingKey[]): void;
}

export function createSettingsStore(kv: KeyValue | null): SettingsStore {
  let state: DevSettings | null = null;
  const listeners = new Set<() => void>();

  const read = (): DevSettings => {
    if (state) return state;
    let raw: string | null = null;
    try {
      raw = kv?.getItem(STORAGE_KEY) ?? null;
    } catch {
      // Blocked storage: defaults for this session.
    }
    state = parseSettings(raw);
    return state;
  };

  const commit = (next: DevSettings) => {
    const prev = read();
    if ((Object.keys(next) as DevSettingKey[]).every((k) => next[k] === prev[k])) return;
    state = next;
    try {
      kv?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not saved, but it still applies until the app reloads.
    }
    listeners.forEach((l) => l());
  };

  return {
    getSnapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      // Validate through the parser, so a bad value can't get in from the UI either.
      commit(parseSettings(JSON.stringify({ ...read(), ...patch })));
    },
    reset(keys) {
      const all = Object.keys(DEFAULT_SETTINGS) as DevSettingKey[];
      const back = Object.fromEntries((keys ?? all).map((k) => [k, DEFAULT_SETTINGS[k]]));
      commit({ ...read(), ...back });
    },
  };
}

/**
 * The pipelines to offer in the model picker: main first, then every
 * alternative any clip has, then the saved pick even if no clip has it (yet).
 */
export function pipelineChoices(variantNames: readonly string[], selected: string): string[] {
  const out = [MAIN_PIPELINE];
  for (const n of [...variantNames].sort()) if (!out.includes(n)) out.push(n);
  if (!out.includes(selected)) out.push(selected);
  return out;
}

/** Which of a clip's tells files to show for the global pipeline: its own copy, else main (the first). */
export function variantIndex(variants: readonly { name: string }[], pipeline: string): number {
  const i = variants.findIndex((v) => v.name === pipeline);
  return i >= 0 ? i : 0;
}
