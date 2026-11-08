/**
 * The first-run gesture hint over the feed: a demo of how to open the double
 * take (with Both, a hold and then a double tap), on the first clips with
 * tells, each session, until the viewer has opened a double take
 * `OPENS_TO_LEARN` times. Pure (no React Native), so it runs under
 * `node --test`; `store.ts` binds it to the device's storage and React, and
 * `GestureHint.tsx` draws it.
 */

/** Opening a double take this many times teaches the gesture; the hint never comes back after. */
export const OPENS_TO_LEARN = 2;
/** A settled, playing clip shows its hint after this long, ms (also counted from the landing's hand-off). */
export const SHOW_DELAY_MS = 600;
/** A hint stays at least this long on screen before it fades out by itself, ms. */
export const HINT_TIMEOUT_MS = 6000;
/** How many times a hint plays through before it fades out by itself. */
export const LOOPS = 2;
/** A session gives up on the hint after it started on this many clips without being seen through. */
export const MAX_TRIES_PER_SESSION = 3;

/** Kept on the device. */
export interface HintProgress {
  /** Double takes opened so far (by any gesture or the button), up to OPENS_TO_LEARN. */
  opens: number;
}

export const FRESH: Readonly<HintProgress> = Object.freeze({ opens: 0 });

/** The dev settings' "Keep showing": on every clip with tells, whatever the progress. */
export type HintForce = 'off' | 'doubleTake';

/** This app run only. */
export interface HintSession {
  /** The hint ran its course (timed out) or the viewer opened a double take: no more this session. */
  done: boolean;
  /** Clips the hint started on this session. */
  tries: number;
}

export const NEW_SESSION: Readonly<HintSession> = Object.freeze({ done: false, tries: 0 });

export interface ClipContext {
  hasTells: boolean;
  /** The double take is open, a sheet or screen covers the clip, the clip is paused, a game runs… */
  blocked: boolean;
}

/** Whether this clip should show the hint once its delay is up. */
export function shouldShow(progress: HintProgress, session: HintSession, clip: ClipContext, force: HintForce = 'off'): boolean {
  if (clip.blocked || !clip.hasTells) return false;
  if (force === 'doubleTake') return true;
  if (progress.opens >= OPENS_TO_LEARN) return false;
  return !session.done && session.tries < MAX_TRIES_PER_SESSION;
}

/** The viewer opened a double take. */
export function recordOpen(p: HintProgress): HintProgress {
  return p.opens >= OPENS_TO_LEARN ? p : { ...p, opens: p.opens + 1 };
}

/** The hint started showing on a clip. */
export function startHint(session: HintSession): HintSession {
  return { ...session, tries: session.tries + 1 };
}

/** Why the hint went away. */
export type HintEnd = 'timeout' | 'gesture' | 'left';

/**
 * The hint went away: it ran its course, the viewer did what it shows, or the
 * clip stopped being active or got covered. Cut short ('left'), it may come
 * back on a later clip; seen through, not this session.
 */
export function endHint(session: HintSession, why: HintEnd): HintSession {
  return why === 'left' ? session : { ...session, done: true };
}

/** Progress from stored JSON; anything missing or malformed starts fresh. */
export function parseProgress(raw: string | null | undefined): HintProgress {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // Corrupt storage: start over.
  }
  const opens = typeof o.opens === 'number' && Number.isFinite(o.opens) ? Math.max(0, Math.min(OPENS_TO_LEARN, Math.floor(o.opens))) : 0;
  return { opens };
}

/** What the gesture demo plays, in order, for the viewer's setting. */
export type DemoStep = 'doubleTap' | 'hold';

/** Both: hold first (Space on desktop), then double tap (double-click). */
export function demoSteps(mode: 'hold' | 'doubleTap' | 'both'): DemoStep[] {
  if (mode === 'both') return ['hold', 'doubleTap'];
  return [mode];
}

/** One pass of each demo, ms: short, so the whole walk-through stays brief. */
export const STEP_MS: Readonly<Record<DemoStep, number>> = Object.freeze({ hold: 2600, doubleTap: 2000 });

/** One pass through every step, ms. */
export function loopMs(steps: readonly DemoStep[]): number {
  return steps.reduce((n, st) => n + STEP_MS[st], 0);
}

/** How long a hint stays before fading out by itself: LOOPS full passes, at least HINT_TIMEOUT_MS. */
export function hintTimeout(steps: readonly DemoStep[]): number {
  return Math.max(HINT_TIMEOUT_MS, LOOPS * loopMs(steps));
}

/** The hint's only words. `mouse`: a fine pointer; `spaceKey`: the layout opens it with Space (desktop feed). */
export function demoCaption(step: DemoStep, input: { mouse: boolean; spaceKey: boolean }): string {
  if (step === 'doubleTap') return input.mouse ? 'Double-click' : 'Double tap';
  return input.mouse && input.spaceKey ? 'Hold Space' : 'Hold';
}
