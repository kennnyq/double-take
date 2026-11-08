import { useCallback, useMemo, useState } from 'react';
import { choosePreset } from './presetChoice';

/**
 * Designs on trial: a page's design decisions as named axes ("trials"), plus
 * whole designs ("presets") that set every axis at once. Development only.
 *
 * - `?design=<preset>` picks a preset; `?<param>=<value>` overrides one axis.
 *   The address only ever holds what differs from the preset, so a copied
 *   link opens exactly the same design.
 * - Without a `?design=` in the address, the last design shown (saved in
 *   localStorage) comes back.
 * - Otherwise the default preset shows (the first, unless one is named).
 * - In production every axis is the default preset's, and nothing is read or
 *   saved.
 */

export interface TrialItem<V extends string = string> {
  value: V;
  label: string;
}

export interface Trial<V extends string = string> {
  label: string;
  /** The query parameter that picks it, as in `?gallery=`. */
  param: string;
  /** Heading it sits under in the panel. */
  group: string;
  items: readonly TrialItem<V>[];
}

export type Trials = Record<string, Trial>;

export type TrialValues<T extends Trials> = {
  [K in keyof T]: T[K]['items'][number]['value'];
};

export interface Preset<T extends Trials> {
  id: string;
  label: string;
  /** One line on what makes it different. */
  note: string;
  values: TrialValues<T>;
}

export const DEV = __DEV__ || new URLSearchParams(window.location.search).has('dev');

const PRESET_PARAM = 'design';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the address still carries the design.
  }
}

function valid<T extends Trials>(trials: T, key: keyof T, value: string | null): value is string {
  return value !== null && trials[key].items.some((item) => item.value === value);
}

interface State<T extends Trials> {
  preset: string;
  values: TrialValues<T>;
}

function initialState<T extends Trials>(
  trials: T,
  presets: readonly Preset<T>[],
  prefix: string,
  defaultId: string | undefined,
): State<T> {
  if (!DEV) {
    const preset = choosePreset(presets, { fallback: defaultId });
    return { preset: preset.id, values: { ...preset.values } };
  }

  const url = new URLSearchParams(window.location.search);
  const fromUrl = url.get(PRESET_PARAM);
  const preset = choosePreset(presets, { fromUrl, stored: read(`${prefix}${PRESET_PARAM}`), fallback: defaultId });
  const values = { ...preset.values };

  for (const key of Object.keys(trials) as (keyof T)[]) {
    const trial = trials[key];
    // A link reproduces its design exactly; a bare visit restores the last one.
    const candidate = url.get(trial.param) ?? (fromUrl ? null : read(`${prefix}${trial.param}`));
    if (valid(trials, key, candidate)) (values as Record<keyof T, string>)[key] = candidate;
  }
  return { preset: preset.id, values };
}

function syncUrl<T extends Trials>(trials: T, preset: Preset<T>, values: TrialValues<T>) {
  const url = new URL(window.location.href);
  url.searchParams.set(PRESET_PARAM, preset.id);
  for (const key of Object.keys(trials) as (keyof T)[]) {
    const { param } = trials[key];
    if (values[key] === preset.values[key]) url.searchParams.delete(param);
    else url.searchParams.set(param, values[key]);
  }
  window.history.replaceState(window.history.state, '', url);
}

export interface TrialsApi<T extends Trials> {
  trials: T;
  presets: readonly Preset<T>[];
  values: TrialValues<T>;
  preset: Preset<T>;
  presetIndex: number;
  /** Axes that differ from the preset. */
  edited: (keyof T)[];
  select<K extends keyof T>(key: K, value: TrialValues<T>[K]): void;
  applyPreset(id: string): void;
  step(offset: number): void;
}

/** `defaultId` names the preset shown when nothing else picks one (default: the first). */
export function useTrials<T extends Trials>(
  trials: T,
  presets: readonly Preset<T>[],
  prefix: string,
  defaultId?: string,
): TrialsApi<T> {
  const [state, setState] = useState(() => initialState(trials, presets, prefix, defaultId));
  const presetIndex = Math.max(
    0,
    presets.findIndex((p) => p.id === state.preset),
  );
  const preset = presets[presetIndex];

  const commit = useCallback(
    (next: State<T>) => {
      setState(next);
      if (!DEV) return;
      const p = presets.find((x) => x.id === next.preset) ?? presets[0];
      write(`${prefix}${PRESET_PARAM}`, p.id);
      for (const key of Object.keys(trials) as (keyof T)[]) write(`${prefix}${trials[key].param}`, next.values[key]);
      syncUrl(trials, p, next.values);
    },
    [prefix, presets, trials],
  );

  const select = useCallback(
    <K extends keyof T>(key: K, value: TrialValues<T>[K]) =>
      commit({ preset: state.preset, values: { ...state.values, [key]: value } }),
    [commit, state],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const p = presets.find((x) => x.id === id);
      if (p) commit({ preset: p.id, values: { ...p.values } });
    },
    [commit, presets],
  );

  const step = useCallback(
    (offset: number) => applyPreset(presets[(presetIndex + offset + presets.length) % presets.length].id),
    [applyPreset, presetIndex, presets],
  );

  const edited = useMemo(
    () => (Object.keys(trials) as (keyof T)[]).filter((k) => state.values[k] !== preset.values[k]),
    [preset, state.values, trials],
  );

  // Every axis has a value, even one added since the state was made (a hot
  // reload keeps the old state): the preset's, where the state has none.
  const values = useMemo(() => ({ ...preset.values, ...state.values }), [preset, state.values]);

  return { trials, presets, values, preset, presetIndex, edited, select, applyPreset, step };
}
