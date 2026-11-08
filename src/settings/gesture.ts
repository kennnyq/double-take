/**
 * The double take's gestures: what a hold or a double tap does on a clip given
 * the viewer's setting, and how the app words them. Pure, so it runs under
 * `node --test`; the phone (`ClipItem`) and desktop (`DesktopFeed`) feeds ask it.
 *
 * Every clip with tells also has a Double take button that opens it whatever
 * the setting. A gesture the setting gives to the double take loses its usual
 * job on those clips: double tap no longer likes (the heart still does), hold
 * no longer plays at 2x. Clips without tells keep the usual jobs.
 */

import type { RevealGesture } from './settings.ts';

export type GestureKind = 'doubleTap' | 'hold';
export type GestureAction = 'reveal' | 'like' | 'boost' | 'none';

/** Whether the setting gives this gesture to the double take. */
export function revealsWith(kind: GestureKind, mode: RevealGesture): boolean {
  return mode === 'both' || mode === kind;
}

export function gestureAction(
  kind: GestureKind,
  mode: RevealGesture,
  opts: { hasTells: boolean; canBoost: boolean },
): GestureAction {
  if (opts.hasTells && revealsWith(kind, mode)) return 'reveal';
  if (kind === 'doubleTap') return 'like';
  return opts.canBoost ? 'boost' : 'none';
}

export interface Tap {
  /** ms */
  t: number;
  x: number;
  y: number;
}

/** How long after a tap a second one still makes a double tap, on every layout. */
export const DOUBLE_TAP_MS = 250;

/**
 * Whether a single tap (play/pause) waits out DOUBLE_TAP_MS first: only when
 * a double tap would open this clip's double take, so opening it never pauses
 * the clip on the way. Otherwise a tap acts at once (Hold mode, or clips
 * where a double tap likes, which resumes anyway).
 */
export function singleTapWaits(mode: RevealGesture, hasTells: boolean): boolean {
  return hasTells && revealsWith('doubleTap', mode);
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface TapHandlers {
  /** Hold the single tap's action for DOUBLE_TAP_MS (see `singleTapWaits`). */
  wait: boolean;
  onSingle: () => void;
  /** `firstRan`: the first tap's action already ran (it didn't wait). */
  onDouble: (firstRan: boolean) => void;
}

/**
 * Tells single taps from double taps. A single tap acts at once, or after
 * DOUBLE_TAP_MS when it `wait`s, and a second tap in time cancels it. Call
 * `cancel` when the clip stops being the active one, so a waiting tap can't
 * act on the next clip.
 */
export function createTapRecognizer(timers: Timers = realTimers) {
  let last: Tap | null = null;
  let pending: unknown = null;
  const clearPending = () => {
    if (pending !== null) timers.clear(pending);
    pending = null;
  };
  return {
    tap(tap: Tap, h: TapHandlers) {
      if (isDoubleTap(last, tap, DOUBLE_TAP_MS)) {
        const firstRan = pending === null;
        clearPending();
        last = null;
        h.onDouble(firstRan);
        return;
      }
      clearPending();
      last = tap;
      if (!h.wait) {
        h.onSingle();
        return;
      }
      pending = timers.set(() => {
        pending = null;
        h.onSingle();
      }, DOUBLE_TAP_MS);
    },
    /** Forget the last tap and drop a waiting single tap (a hold, or the clip moved on). */
    cancel() {
      clearPending();
      last = null;
    },
  };
}

/**
 * A second tap close in time and place to the first makes a double tap. Where
 * the press has no position (React Native Web can leave `locationX` unset),
 * timing alone decides.
 */
export function isDoubleTap(prev: Tap | null, next: Tap, windowMs: number, slop = 60): boolean {
  if (!prev) return false;
  const dt = next.t - prev.t;
  if (dt < 0 || dt >= windowMs) return false;
  const d = Math.hypot(next.x - prev.x, next.y - prev.y);
  return Number.isFinite(d) ? d < slop : true;
}

/**
 * What a press of Space does on desktop. With hold giving the double take, a
 * press is only a tap (play/pause) once it's released before the hold delay;
 * Double-tap disambiguation is handled by createSpaceRecognizer.
 */
export function spaceWaitsForHold(mode: RevealGesture, hasTells: boolean): boolean {
  return hasTells && revealsWith('hold', mode);
}

/** How the viewer opens it, lower case: "hold a clip", "hold Space or double-click", … */
export function revealHow(mode: RevealGesture, desktop: boolean): string {
  if (desktop) {
    if (mode === 'hold') return 'hold Space';
    if (mode === 'doubleTap') return 'double-click the video';
    return 'hold Space or double-click';
  }
  if (mode === 'hold') return 'hold a clip';
  if (mode === 'doubleTap') return 'double-tap a clip';
  return 'hold or double-tap a clip';
}

export interface GestureOption {
  id: RevealGesture;
  title: string;
  description: string;
}

/** The Settings choices, worded for the layout. */
export function gestureOptions(desktop: boolean): GestureOption[] {
  if (desktop) {
    return [
      {
        id: 'hold',
        title: 'Hold Space',
        description: 'Hold Space, or click and hold the video. A quick Space plays/pauses; double-click still likes.',
      },
      { id: 'doubleTap', title: 'Double-click', description: 'Double-click the video or double-tap Space. A single Space plays/pauses. Like with the heart.' },
      { id: 'both', title: 'Both', description: 'Hold or double-tap Space, or double-click the video. A single Space plays/pauses. Like with the heart.' },
    ];
  }
  return [
    { id: 'hold', title: 'Hold', description: 'Press and hold a clip. Double-tap still likes.' },
    { id: 'doubleTap', title: 'Double tap', description: 'Double-tap a clip. Like with the heart; hold still plays at 2x.' },
    { id: 'both', title: 'Both', description: 'Hold or double-tap a clip. Like with the heart.' },
  ];
}
