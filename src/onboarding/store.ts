import { useEffect, useSyncExternalStore } from 'react';
import { devStorage } from '@/devtools/storage';
import { DEV_TOOLS } from '@/devtools/store';
import { settingsStorage } from '@/settings/storage';
import {
  endHint,
  FRESH,
  NEW_SESSION,
  parseProgress,
  recordOpen,
  shouldShow,
  startHint,
  type ClipContext,
  type HintEnd,
  type HintForce,
  type HintProgress,
  type HintSession,
} from './hints';

/**
 * The gesture hint's state for this device and app run: progress kept with
 * the app settings, the session in memory, and the dev overrides with the dev
 * settings. The rules are in `hints.ts`.
 */

const PROGRESS_KEY = 'double-take.hints.v1';
const DEV_KEY = 'double-take:dev-hints:v1';

/**
 * The hint's designs, on trial in the dev settings, all something physical
 * pressing the clip: a hand silhouette with a soft drop shadow (the default),
 * a drawn finger, or the same finger with only its shadows and a pressed glow.
 */
export const HINT_DESIGNS = ['hand', 'finger', 'fingertip'] as const;
export type HintDesign = (typeof HINT_DESIGNS)[number];
/** Which input the hint's words name: by the pointer (a fine one says "click"), or forced; `still` as with Reduce Motion. */
export const HINT_INPUTS = ['auto', 'touch', 'mouse', 'still'] as const;
export type HintInput = (typeof HINT_INPUTS)[number];
const FORCES: readonly HintForce[] = ['off', 'doubleTake'];

export interface HintState {
  progress: HintProgress;
  session: HintSession;
  /** Screens that keep the hint away while they're up (the landing, the timed game), counted. */
  blocks: number;
  force: HintForce;
  design: HintDesign;
  input: HintInput;
  /** "Show now" from the dev settings: the next active clip with tells shows it, whatever the rules. */
  request: { id: number } | null;
  /** Bumped by a reset, so a hint on screen starts over. */
  epoch: number;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

type DevPart = Pick<HintState, 'force' | 'design' | 'input'>;
export const DEV_DEFAULTS: Readonly<DevPart> = Object.freeze({ force: 'off', design: 'hand', input: 'auto' });

function oneOf<T>(list: readonly T[], v: unknown, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

function readDev(): DevPart {
  if (!DEV_TOOLS) return { ...DEV_DEFAULTS };
  const o = safe(() => JSON.parse(devStorage?.getItem(DEV_KEY) ?? '{}') as Record<string, unknown>, {}) ?? {};
  return {
    force: oneOf(FORCES, o.force, DEV_DEFAULTS.force),
    design: oneOf(HINT_DESIGNS, o.design, DEV_DEFAULTS.design),
    input: oneOf(HINT_INPUTS, o.input, DEV_DEFAULTS.input),
  };
}

let state: HintState = {
  progress: parseProgress(safe(() => settingsStorage?.getItem(PROGRESS_KEY) ?? null, null)),
  session: { ...NEW_SESSION },
  blocks: 0,
  ...readDev(),
  request: null,
  epoch: 0,
};
const listeners = new Set<() => void>();

function set(patch: Partial<HintState>) {
  const next = { ...state, ...patch };
  if ((Object.keys(patch) as (keyof HintState)[]).every((k) => next[k] === state[k])) return;
  if (next.progress !== state.progress) safe(() => settingsStorage?.setItem(PROGRESS_KEY, JSON.stringify(next.progress)), undefined);
  if (next.force !== state.force || next.design !== state.design || next.input !== state.input)
    safe(() => devStorage?.setItem(DEV_KEY, JSON.stringify({ force: next.force, design: next.design, input: next.input })), undefined);
  state = next;
  listeners.forEach((l) => l());
}

export const hints = {
  getSnapshot: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Whether the clip should show the hint now. */
  shouldShow: (clip: ClipContext): boolean => state.blocks === 0 && shouldShow(state.progress, state.session, clip, state.force),
  /** The viewer opened a double take, by any gesture or the button. */
  recordOpen: () => set({ progress: recordOpen(state.progress) }),
  start: () => set({ session: startHint(state.session) }),
  end: (why: HintEnd) => set({ session: endHint(state.session, why) }),
  /** The hint as for a brand-new viewer, starting now. */
  reset: () => set({ progress: { ...FRESH }, session: { ...NEW_SESSION }, epoch: state.epoch + 1 }),
  setForce: (force: HintForce) => set({ force, epoch: state.epoch + 1 }),
  setDesign: (design: HintDesign) => set({ design }),
  setInput: (input: HintInput) => set({ input }),
  /** Plays the hint on the active clip as soon as nothing covers it (dev settings). */
  showNow: () => set({ request: { id: (state.request?.id ?? 0) + 1 }, epoch: state.epoch + 1 }),
  /** The request was played. */
  takeRequest: (id: number) => {
    if (state.request?.id === id) set({ request: null });
  },
  /** Keeps the hint away until the returned function is called. */
  block(): () => void {
    set({ blocks: state.blocks + 1 });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      set({ blocks: state.blocks - 1 });
    };
  },
};

export function useHints(): HintState {
  return useSyncExternalStore(hints.subscribe, hints.getSnapshot, hints.getSnapshot);
}

/**
 * Keeps the feed's hint away while the calling screen is mounted (and `on`),
 * e.g. the timed guessing game or the landing.
 */
export function useBlockHints(on = true) {
  useEffect(() => (on ? hints.block() : undefined), [on]);
}
