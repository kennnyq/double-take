import { useEffect, useSyncExternalStore } from 'react';
import { devStorage } from '@/devtools/storage';
import { DEV_TOOLS } from '@/devtools/store';
import { settingsStorage } from '@/settings/storage';
import {
  enterClip,
  endHint,
  FRESH,
  hintFor,
  NEW_SESSION,
  parseProgress,
  recordOpen,
  startHint,
  type ClipContext,
  type HintEnd,
  type HintForce,
  type HintKind,
  type HintProgress,
  type HintSession,
} from './hints';

/**
 * The hints' state for this device and app run: progress kept with the app
 * settings, the session in memory, and the dev overrides with the dev settings.
 * The rules are in `hints.ts`.
 */

const PROGRESS_KEY = 'double-take.hints.v1';
const DEV_KEY = 'double-take:dev-hints:v1';

/** How the hint draws: by the input (a fine pointer gets the mouse and keyboard), or forced in the dev settings. */
export const HINT_STYLES = ['auto', 'touch', 'mouse', 'still'] as const;
export type HintStyle = (typeof HINT_STYLES)[number];
const FORCES: readonly HintForce[] = ['off', 'swipe', 'doubleTake'];

export interface HintState {
  progress: HintProgress;
  session: HintSession;
  /** Screens that keep every hint away while they're up (the timed game), counted. */
  blocks: number;
  force: HintForce;
  style: HintStyle;
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

function readDev(): { force: HintForce; style: HintStyle } {
  if (!DEV_TOOLS) return { force: 'off', style: 'auto' };
  const o = safe(() => JSON.parse(devStorage?.getItem(DEV_KEY) ?? '{}') as Record<string, unknown>, {});
  return {
    force: FORCES.includes(o?.force as HintForce) ? (o.force as HintForce) : 'off',
    style: HINT_STYLES.includes(o?.style as HintStyle) ? (o.style as HintStyle) : 'auto',
  };
}

let state: HintState = {
  progress: parseProgress(safe(() => settingsStorage?.getItem(PROGRESS_KEY) ?? null, null)),
  session: { ...NEW_SESSION },
  blocks: 0,
  ...readDev(),
  epoch: 0,
};
const listeners = new Set<() => void>();

function set(patch: Partial<HintState>) {
  const next = { ...state, ...patch };
  if ((Object.keys(patch) as (keyof HintState)[]).every((k) => next[k] === state[k])) return;
  if (next.progress !== state.progress) safe(() => settingsStorage?.setItem(PROGRESS_KEY, JSON.stringify(next.progress)), undefined);
  if (next.force !== state.force || next.style !== state.style)
    safe(() => devStorage?.setItem(DEV_KEY, JSON.stringify({ force: next.force, style: next.style })), undefined);
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
  /** Which hint the clip should show now, if any. */
  hintFor: (clip: ClipContext): HintKind | null => (state.blocks > 0 ? null : hintFor(state.progress, state.session, clip, state.force)),
  enterClip(clipId: string) {
    const r = enterClip(state.session, clipId);
    set({ session: r.session, progress: r.swiped && !state.progress.swiped ? { ...state.progress, swiped: true } : state.progress });
  },
  /** The viewer opened a double take, by any gesture or the button. */
  recordOpen: () => set({ progress: recordOpen(state.progress) }),
  start: (kind: HintKind) => set({ session: startHint(state.session, kind) }),
  end(kind: HintKind, why: HintEnd) {
    set(endHint(state.progress, state.session, kind, why));
  },
  /** Every hint as for a brand-new viewer, starting now. */
  reset: () => set({ progress: { ...FRESH }, session: { ...NEW_SESSION }, epoch: state.epoch + 1 }),
  setForce: (force: HintForce) => set({ force, epoch: state.epoch + 1 }),
  setStyle: (style: HintStyle) => set({ style }),
  /** Keeps every hint away until the returned function is called. */
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
 * Keeps the feed's hints away while the calling screen is mounted (and `on`),
 * e.g. the timed guessing game.
 */
export function useBlockHints(on = true) {
  useEffect(() => (on ? hints.block() : undefined), [on]);
}
