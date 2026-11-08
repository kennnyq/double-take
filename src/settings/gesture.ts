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
 * otherwise Space plays/pauses at once, as it always has.
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
        description: 'Hold Space, or click and hold the video. A quick Space still plays and pauses; double-click still likes.',
      },
      { id: 'doubleTap', title: 'Double-click', description: 'Double-click the video. Like with the heart.' },
      { id: 'both', title: 'Both', description: 'Hold Space or double-click. Like with the heart.' },
    ];
  }
  return [
    { id: 'hold', title: 'Hold', description: 'Press and hold a clip. Double-tap still likes.' },
    { id: 'doubleTap', title: 'Double tap', description: 'Double-tap a clip. Like with the heart; hold still plays at 2x.' },
    { id: 'both', title: 'Both', description: 'Hold or double-tap a clip. Like with the heart.' },
  ];
}
