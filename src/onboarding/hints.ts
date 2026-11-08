/**
 * First-run hints over the feed: a one-time "swipe up" for brand-new viewers,
 * then a demo of the gesture that opens the double take, on later sessions too,
 * until the viewer has opened a double take `OPENS_TO_LEARN` times. Pure (no
 * React Native), so it runs under `node --test`; `store.ts` binds it to the
 * device's storage and React, and `GestureHint.tsx` draws it.
 *
 * At most one hint shows at a time. The swipe hint goes first; the double take
 * hint waits for the next clip with tells.
 */

/** Opening a double take this many times teaches the gesture; the hint never comes back after. */
export const OPENS_TO_LEARN = 2;
/** A clip must stay on screen this long before a hint fades in, ms. */
export const SHOW_DELAY_MS = 1400;
/** A hint fades out by itself after this long on screen, ms (a couple of loops). */
export const HINT_TIMEOUT_MS = 7000;
/** A session gives up on the double take hint after it started on this many clips without being seen through. */
export const MAX_TRIES_PER_SESSION = 3;

export type HintKind = 'swipe' | 'doubleTake';

/** Kept on the device. */
export interface HintProgress {
  /** Double takes opened so far (by any gesture or the button), up to OPENS_TO_LEARN. */
  opens: number;
  /** The viewer has moved past a first clip, or seen the swipe hint through. */
  swiped: boolean;
}

export const FRESH: Readonly<HintProgress> = Object.freeze({ opens: 0, swiped: false });

/** How the dev settings override the rules. */
export type HintForce = 'off' | 'swipe' | 'doubleTake';

/** This app run only. */
export interface HintSession {
  /** The double take hint ran its course (timed out) or the viewer opened one: no more this session. */
  done: boolean;
  /** Clips the double take hint started on this session. */
  tries: number;
  /** The first clip shown this session; moving to another one counts as a swipe. */
  firstClip: string | null;
}

export const NEW_SESSION: Readonly<HintSession> = Object.freeze({ done: false, tries: 0, firstClip: null });

export interface ClipContext {
  clipId: string;
  hasTells: boolean;
  /** The double take is open, a sheet or screen covers the clip, the clip is paused, a game runs… */
  blocked: boolean;
  /** The layout can show a swipe hint (the phone feed; desktop has wheel, keys and buttons). */
  canSwipe: boolean;
}

/** Which hint (if any) this clip should show once its delay is up. */
export function hintFor(progress: HintProgress, session: HintSession, clip: ClipContext, force: HintForce = 'off'): HintKind | null {
  if (clip.blocked) return null;
  if (force === 'swipe') return clip.canSwipe ? 'swipe' : null;
  if (force === 'doubleTake') return clip.hasTells ? 'doubleTake' : null;
  if (!progress.swiped && clip.canSwipe) {
    // Only on the first clip: anywhere else they've already swiped.
    return session.firstClip === null || session.firstClip === clip.clipId ? 'swipe' : null;
  }
  if (!clip.hasTells || progress.opens >= OPENS_TO_LEARN) return null;
  if (session.done || session.tries >= MAX_TRIES_PER_SESSION) return null;
  return 'doubleTake';
}

/** The viewer opened a double take. */
export function recordOpen(p: HintProgress): HintProgress {
  return p.opens >= OPENS_TO_LEARN ? p : { ...p, opens: p.opens + 1 };
}

/**
 * A clip became the active one. Returns the new session, and whether that
 * counts as the viewer having swiped (moved past the session's first clip).
 */
export function enterClip(session: HintSession, clipId: string): { session: HintSession; swiped: boolean } {
  if (session.firstClip === null) return { session: { ...session, firstClip: clipId }, swiped: false };
  return { session, swiped: session.firstClip !== clipId };
}

/** A hint started showing on a clip. */
export function startHint(session: HintSession, kind: HintKind): HintSession {
  return kind === 'doubleTake' ? { ...session, tries: session.tries + 1 } : session;
}

/** Why a hint went away. */
export type HintEnd = 'timeout' | 'gesture' | 'left';

/**
 * A hint went away: it ran its course, the viewer did what it shows, or the
 * clip stopped being active or got covered. A hint cut short ('left') may come
 * back on a later clip; one seen through doesn't.
 */
export function endHint(
  progress: HintProgress,
  session: HintSession,
  kind: HintKind,
  why: HintEnd,
): { progress: HintProgress; session: HintSession } {
  if (kind === 'swipe') {
    // Seen through or acted on: never again. Cut short by a sheet: next time.
    return { progress: why === 'left' ? progress : { ...progress, swiped: true }, session };
  }
  return { progress, session: why === 'left' ? session : { ...session, done: true } };
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
  return { opens, swiped: o.swiped === true };
}

/** What the gesture demo plays, in order, for the viewer's setting. */
export type DemoStep = 'doubleTap' | 'hold';

export function demoSteps(mode: 'hold' | 'doubleTap' | 'both'): DemoStep[] {
  if (mode === 'both') return ['doubleTap', 'hold'];
  return [mode];
}

/** The hint's only words. `mouse`: a fine pointer; `spaceKey`: the layout opens it with Space (desktop feed). */
export function demoCaption(step: DemoStep | 'swipe', input: { mouse: boolean; spaceKey: boolean }): string {
  if (step === 'swipe') return 'Swipe up';
  if (step === 'doubleTap') return input.mouse ? 'Double-click' : 'Double tap';
  return input.mouse && input.spaceKey ? 'Hold Space' : 'Hold';
}
