/**
 * Dev settings: the choices on trial, their defaults and a small store that
 * keeps them in a key-value storage. Pure (no React Native), so it runs under
 * `node --test`; `store.ts` binds it to the device's storage and React.
 */

import {
  SPOTLIGHT_EFFECTS,
  SPOTLIGHT_PADDINGS,
  SPOTLIGHT_SHAPES,
  SPOTLIGHT_STRENGTHS,
  type SpotlightEffect,
  type SpotlightPadding,
  type SpotlightShape,
  type SpotlightStrength,
} from '../feed/spotlight.ts';
import { REVEAL_VARIANTS, type RevealVariant } from '../feed/reveal.ts';

export { SPOTLIGHT_EFFECTS, SPOTLIGHT_PADDINGS, SPOTLIGHT_SHAPES, SPOTLIGHT_STRENGTHS };

/**
 * How the double take shows that the next tap ends it: the forward button
 * turns into a check (done), step dots fill up (dots), both together (both), a step count (count),
 * or only the faint "Tap to finish" line (text).
 */
export const END_CUES = ['both', 'done', 'dots', 'count', 'text'] as const;
export type EndCue = (typeof END_CUES)[number];

/** The phone's tab bar while the double take is open: stays as it is, or fades out with the clip's chrome. */
export const TAB_BAR_MODES = ['stay', 'fade'] as const;
export type TabBarMode = (typeof TAB_BAR_MODES)[number];

/** How long a press must last to count as a hold, in ms. */
export const HOLD_DELAYS = [250, 350, 500] as const;
export type HoldDelay = (typeof HOLD_DELAYS)[number];

/** Where the dev settings launcher floats; `auto` picks a free spot for the layout. */
export const LAUNCHER_CORNERS = ['auto', 'topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const;
export type LauncherCorner = (typeof LAUNCHER_CORNERS)[number];

/** The published tells file; alternatives are named after their pipeline (e.g. `claude`). */
export const MAIN_PIPELINE = 'main';

/**
 * Settings on trial. How the double take opens is the viewer's choice
 * (`revealGesture` in `src/settings/`); only how long a hold lasts stays here.
 */
export interface DevSettings {
  holdMs: HoldDelay;
  /** Shared Home/Game order; takes effect on reload. */
  feedOrder: 'best' | 'original';
  /**
   * The viewer's own pick of tells pipeline ("model") for every clip, or ''
   * for the default (the cloud's `tells_pipeline`, else main). See `resolvePipeline`.
   */
  pipelinePick: string;
  launcher: LauncherCorner;
  /**
   * The double take's spotlight outside the tell's area: off, darken (default),
   * a cheap blur (a blurred still) or the full live blur. A new key, so a
   * stored pick from the first version (darken/blur/both) falls back to darken.
   */
  spotlightEffect: SpotlightEffect;
  spotlightStrength: SpotlightStrength;
  spotlightShape: SpotlightShape;
  /** Room around the tell's box (and so between the subject and the card). */
  spotlightPadding: SpotlightPadding;
  /** Reviewers: mark tells that are unreviewed model drafts in the double take. Off: the card shows only the reason. */
  markDrafts: boolean;
  /** Judges and demos: name the models under each step of the result's "How we checked". Off: no model names. */
  showModels: boolean;
  endCue: EndCue;
  /** How the double take card's text comes in: Siri's answer card (default) or WWDC24's text transition. */
  textReveal: RevealVariant;
  /** The phone's tab bar during the double take: stays (default) or fades out with the chrome. */
  tabBarInDoubleTake: TabBarMode;
}

export type DevSettingKey = keyof DevSettings;

export const DEFAULT_SETTINGS: Readonly<DevSettings> = Object.freeze({
  holdMs: 350,
  feedOrder: 'best',
  pipelinePick: '',
  launcher: 'auto',
  spotlightEffect: 'darken',
  spotlightStrength: 2,
  spotlightShape: 'feather',
  spotlightPadding: 'roomy',
  markDrafts: false,
  showModels: false,
  endCue: 'both',
  textReveal: 'siri',
  tabBarInDoubleTake: 'stay',
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
  return {
    holdMs: oneOf(HOLD_DELAYS, o.holdMs, d.holdMs),
    feedOrder: oneOf(['best', 'original'] as const, o.feedOrder, d.feedOrder),
    pipelinePick: isPipelineName(o.pipelinePick)
      ? o.pipelinePick
      : // Before cloud defaults, every saved state held `pipeline: 'main'`, picked or not;
        // only a non-main value there was a real pick.
        isPipelineName(o.pipeline) && o.pipeline !== MAIN_PIPELINE
        ? o.pipeline
        : d.pipelinePick,
    launcher: oneOf(LAUNCHER_CORNERS, o.launcher, d.launcher),
    spotlightEffect: oneOf(SPOTLIGHT_EFFECTS, o.spotlightEffect, d.spotlightEffect),
    spotlightStrength: oneOf(SPOTLIGHT_STRENGTHS, o.spotlightStrength, d.spotlightStrength),
    spotlightShape: oneOf(SPOTLIGHT_SHAPES, o.spotlightShape, d.spotlightShape),
    spotlightPadding: oneOf(SPOTLIGHT_PADDINGS, o.spotlightPadding, d.spotlightPadding),
    markDrafts: typeof o.markDrafts === 'boolean' ? o.markDrafts : d.markDrafts,
    showModels: typeof o.showModels === 'boolean' ? o.showModels : d.showModels,
    endCue: oneOf(END_CUES, o.endCue, d.endCue),
    textReveal: oneOf(REVEAL_VARIANTS, o.textReveal, d.textReveal),
    tabBarInDoubleTake: oneOf(TAB_BAR_MODES, o.tabBarInDoubleTake, d.tabBarInDoubleTake),
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

/** A pipeline name as tells files are named: letters, digits, `_`, `.`, `-`. */
export function isPipelineName(v: unknown): v is string {
  return typeof v === 'string' && /^[\w.-]{1,40}$/.test(v);
}

/**
 * The pipeline every clip shows: the viewer's own pick, else the cloud default
 * if it's a valid name, else main. (A valid name no clip has still shows main,
 * per clip, through `variantIndex`.)
 */
export function resolvePipeline(pick: string, cloudDefault: unknown): string {
  if (isPipelineName(pick)) return pick;
  return isPipelineName(cloudDefault) ? cloudDefault : MAIN_PIPELINE;
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
