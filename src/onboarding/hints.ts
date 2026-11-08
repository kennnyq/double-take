/**
 * The gesture hint returns on every page load for signed-out visitors.
 * Signed-in viewers who have seen it for MIN_VISIBLE_MS skip it on later
 * visits. Pure rules; store.ts persists progress and GestureHint.tsx reports
 * actual visibility after the entrance has finished.
 */

/** A hint counts as seen after this long fully visible on one clip, ms. */
export const MIN_VISIBLE_MS = 500;
/** A settled, playing clip shows its hint after this long, ms (also counted from the landing's hand-off). */
export const SHOW_DELAY_MS = 600;
/** A hint stays at least this long on screen before it fades out by itself, ms. */
export const HINT_TIMEOUT_MS = 6000;
/** How many times a hint plays through before it fades out by itself. */
export const LOOPS = 2;

/** Kept on this device; only respected across visits for an identified viewer. */
export interface HintProgress {
  seen: boolean;
}
export const FRESH: Readonly<HintProgress> = Object.freeze({ seen: false });

export type HintForce = 'off' | 'doubleTake';

/** This page load/app run only. Quick glimpses never exhaust retries. */
export interface HintSession {
  done: boolean;
  seen: boolean;
}
export const NEW_SESSION: Readonly<HintSession> = Object.freeze({ done: false, seen: false });

export interface ClipContext {
  hasTells: boolean;
  /** The double take is open, a sheet or screen covers the clip, the clip is paused, a game runs… */
  blocked: boolean;
}

export function shouldShow(progress: HintProgress, session: HintSession, clip: ClipContext, force: HintForce = 'off', rememberSeen = false): boolean {
  if (clip.blocked || !clip.hasTells) return false;
  if (force === 'doubleTake') return true;
  return !session.done && !session.seen && !(rememberSeen && progress.seen);
}

/** Visibility is continuous on one clip; brief glimpses do not add up. */
export function recordSeen(progress: HintProgress, visibleMs: number): HintProgress {
  return progress.seen || visibleMs < MIN_VISIBLE_MS ? progress : { seen: true };
}

export type HintEnd = 'timeout' | 'gesture' | 'left';

/** Once seen, leaving the clip ends the hint for this visit. */
export function endHint(session: HintSession, why: HintEnd): HintSession {
  return why === 'left' && !session.seen ? session : { ...session, done: true };
}

/** Old open counts do not establish that the prompt was actually seen. */
export function parseProgress(raw: string | null | undefined): HintProgress {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return { seen: !!value && typeof value === 'object' && 'seen' in value && value.seen === true };
  } catch {
    return { ...FRESH };
  }
}

/**
 * What the hint demonstrates: the viewer's gesture setting. Both is one demo,
 * not two in turn: a double tap, then a press and hold, under one caption.
 */
export type Demo = 'hold' | 'doubleTap' | 'both';

/** One pass of each demo, ms: short, so the whole hint stays brief. */
export const DEMO_MS: Readonly<Record<Demo, number>> = Object.freeze({ hold: 2600, doubleTap: 2000, both: 3800 });

/** How long a hint stays before fading out by itself: LOOPS full passes, at least HINT_TIMEOUT_MS. */
export function hintTimeout(demo: Demo): number {
  return Math.max(HINT_TIMEOUT_MS, LOOPS * DEMO_MS[demo]);
}

/**
 * The hint's only words. `mouse`: a fine pointer, where a tap is a click and
 * the keyboard hold gesture uses the spacebar.
 */
export function demoCaption(demo: Demo, input: { mouse: boolean }): string {
  const hold = input.mouse ? 'Hold spacebar' : 'Hold';
  const twice = input.mouse ? 'double click' : 'double tap';
  if (demo === 'both') return `${hold} or ${twice}`;
  if (demo === 'doubleTap') return input.mouse ? 'Double click' : 'Double tap';
  return hold;
}
