/**
 * Step-by-step walkthrough of a clip's tells: replay each one in slow motion,
 * outline it and give the reason, marking automatic drafts as such.
 * Pure, so the step order, seek times and wording are unit-tested.
 */
import type { Tell } from './format.ts';

/** Seconds of slack around each tell's window; `timeUpdate` only arrives every 250 ms. */
export const TELL_SLACK = 0.3;

/** Tells visible at playback time `t`. */
export function activeTells(tells: Tell[], t: number, slack = TELL_SLACK): Tell[] {
  return tells.filter((x) => t >= x.t0 - slack && t <= x.t1 + slack);
}

/**
 * Whether a step's box is drawn at playback time `time`. The replay loop runs
 * a little past the tell on both sides; the box only shows while it applies,
 * and tightly when the tell is pinned to a camera shot (no box across a cut).
 */
export function boxShownAt(t: Tell, time: number): boolean {
  const slack = t.shot ? 0.08 : TELL_SLACK;
  return time >= t.t0 - slack && time <= t.t1 + slack;
}

/** Walkthrough order: by the moment each tell is best seen. */
export function walkthroughSteps(tells: Tell[]): Tell[] {
  return [...tells].sort((a, b) => seekTimeFor(a) - seekTimeFor(b) || a.t0 - b.t0);
}

/** Where a step pauses: its focus frame, else a beat into its window (never outside it). */
export function seekTimeFor(t: Tell): number {
  const at = t.focusT ?? t.t0 + Math.min(0.3, (t.t1 - t.t0) / 2);
  return Math.max(0, Math.min(t.t1, Math.max(t.t0, at)));
}

/** Playback speed of the slow-motion replay each step loops. */
export const REPLAY_RATE = 0.35;
/** Bounds on a replay loop, in clip seconds (at REPLAY_RATE, 3 s takes about 8.5 s). */
export const REPLAY_MIN = 1.2;
export const REPLAY_MAX = 3;

/** A shot at least this long (seconds) holds a tell's whole loop; shorter ones can't. */
export const SHOT_LOOP_MIN = 0.9;

export interface Replay {
  from: number;
  to: number;
}

/**
 * The stretch of clip a step loops in slow motion: around the moment of
 * change for before/after tells, else from just before the focus frame.
 * A paused frame hides motion artifacts (morphing, vanishing, sliding feet);
 * a slowed loop shows them. Always inside [0, duration] and covering the
 * focus frame, so the box is on screen for part of every loop.
 */
export function replayWindow(t: Tell, duration = Infinity): Replay {
  const focus = seekTimeFor(t);
  const end = Number.isFinite(duration) && duration > 0 ? duration : Math.max(t.t1, focus) + REPLAY_MAX;
  let from: number;
  let to: number;
  if (t.compareT !== undefined) {
    from = Math.min(focus, t.compareT) - 0.6;
    to = Math.max(focus, t.compareT) + 0.6;
  } else {
    from = Math.max(t.t0 - 0.4, focus - 0.8);
    to = Math.min(t.t1 + 0.4, focus + 1.2);
  }
  if (to - from > REPLAY_MAX) {
    // Keep the focus frame (and a compare frame, when they fit) in view.
    from = Math.max(from, focus - REPLAY_MAX / 3);
    to = from + REPLAY_MAX;
  }
  if (to - from < REPLAY_MIN) to = from + REPLAY_MIN;
  // A tell pinned to a camera shot loops inside that shot when it's long
  // enough, so the loop never crosses a cut (where its box means nothing).
  if (t.shot && t.shot.t1 - t.shot.t0 >= SHOT_LOOP_MIN) {
    const len = Math.min(to - from, t.shot.t1 - t.shot.t0);
    from = Math.min(Math.max(from, t.shot.t0), t.shot.t1 - len);
    to = from + len;
  }
  // Shift, rather than shrink, a loop that runs off either end of the clip.
  if (from < 0) [from, to] = [0, to - from];
  if (to > end) [from, to] = [Math.max(0, from - (to - end)), end];
  const r = (n: number) => Math.round(n * 100) / 100;
  return { from: r(from), to: r(to) };
}

export interface StepCopy {
  /** "1/3" */
  position: string;
  /** True unless a person has checked the tell; the UI marks those "AI draft". */
  unverified: boolean;
  /** Our own checks doubt it (the spot doesn't change, or the model couldn't see it): "unsure". */
  doubtful: boolean;
}

export function stepCopy(t: Tell, i: number, n: number): StepCopy {
  const review = t.review ?? (t.source === 'model' ? 'unreviewed' : undefined);
  const doubtful = t.pixelCheck === 'unchanged' || t.seenInFrames === false || t.confidence === 'low';
  return { position: `${i + 1}/${n}`, unverified: review !== 'verified' && review !== 'spot_checked', doubtful };
}
