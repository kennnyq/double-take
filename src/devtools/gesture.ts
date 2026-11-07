/**
 * What the video's gestures do, given the dev setting for the double take.
 * Pure, so it runs under `node --test`; the phone (`ClipItem`) and desktop
 * (`DesktopFeed`) layouts both ask it.
 *
 * The chosen gesture starts the double take on clips that have tells. The
 * other one keeps its usual job: double tap likes, hold plays at 2x (phone).
 * Clips without tells keep the usual jobs for both.
 */

import type { RevealGesture } from './settings.ts';

export type GestureKind = 'doubleTap' | 'hold';
export type GestureAction = 'reveal' | 'like' | 'boost' | 'none';

export function gestureAction(
  kind: GestureKind,
  mode: RevealGesture,
  opts: { hasTells: boolean; canBoost: boolean },
): GestureAction {
  if (kind === mode && opts.hasTells) return 'reveal';
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

/** The hint on clips that have tells. */
export function revealHint(mode: RevealGesture, desktop: boolean): string {
  if (mode === 'hold') return desktop ? 'Click and hold for a double take' : 'Hold for a double take';
  return desktop ? 'Double-click for a double take' : 'Double-tap for a double take';
}
