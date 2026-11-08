/**
 * Fast-forward and rewind for the double take: the video never jumps straight
 * to a timestamp, it scrubs there. A scrub is a quick, eased sequence of small
 * seeks (slow out, fast through the middle, slow in), so the viewer sees the
 * clip run forwards or backwards to the next tell. It works the same in both
 * directions, which a high playback rate can't (players don't play backwards),
 * and it always takes the planned time, however the clip is encoded.
 *
 * Pure, so the plan and the curve run under `node --test`; `runScrub` drives a
 * player with `requestAnimationFrame`.
 */

export interface ScrubPlan {
  from: number;
  to: number;
  /** How long the scrub takes, in ms (0: already there, nothing to do). */
  ms: number;
  /** Time between seeks, in ms. */
  stepMs: number;
}

export interface ScrubOptions {
  /** Shortest scrub, so even a small move reads as motion. */
  minMs?: number;
  /** Longest scrub, however far the target is. */
  maxMs?: number;
  /** Extra time per second of video crossed. */
  msPerSecond?: number;
  /** Time between seeks (about 30 a second). */
  stepMs?: number;
  /** Closer than this (seconds) counts as already there. */
  epsilon?: number;
}

export const SCRUB_DEFAULTS: Required<ScrubOptions> = {
  minMs: 320,
  maxMs: 950,
  msPerSecond: 110,
  stepMs: 33,
  epsilon: 0.04,
};

/** Plan a scrub from `from` to `to` (seconds of video). */
export function planScrub(from: number, to: number, options: ScrubOptions = {}): ScrubPlan {
  const o = { ...SCRUB_DEFAULTS, ...options };
  const d = Math.abs(to - from);
  if (!Number.isFinite(d) || d < o.epsilon) return { from, to, ms: 0, stepMs: o.stepMs };
  const ms = Math.min(o.maxMs, Math.max(o.minMs, o.minMs + d * o.msPerSecond));
  return { from, to, ms: Math.round(ms), stepMs: o.stepMs };
}

/** Ease in and out (sine): gentle at both ends, steepest (π/2 × average speed) in the middle. */
export function easeInOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return (1 - Math.cos(Math.PI * t)) / 2;
}

/** Where the video should be `elapsedMs` into a scrub. */
export function scrubTimeAt(plan: ScrubPlan, elapsedMs: number): number {
  if (plan.ms <= 0 || elapsedMs >= plan.ms) return plan.to;
  return plan.from + (plan.to - plan.from) * easeInOut(elapsedMs / plan.ms);
}

/** The largest single seek a scrub makes (seconds), for tests and the browser check. */
export function maxStep(plan: ScrubPlan): number {
  if (plan.ms <= 0) return 0;
  return (Math.abs(plan.to - plan.from) * (Math.PI / 2) * plan.stepMs) / plan.ms;
}

/** The slice of a player a scrub drives (expo-video's VideoPlayer and the desktop's HtmlVideoPlayer). */
export interface Scrubbable {
  currentTime: number;
  seekTolerance?: { toleranceBefore?: number; toleranceAfter?: number };
  scrubbingModeOptions?: { scrubbingModeEnabled?: boolean };
}

/** Loose seeks while scrubbing (faster on iOS), exact for the last one. */
const LOOSE = { toleranceBefore: 0.08, toleranceAfter: 0.08 };
const EXACT = { toleranceBefore: 0, toleranceAfter: 0 };

/**
 * Run a scrub on a (paused) player. Returns a cancel function; `onDone` runs
 * once the player has been sent to `plan.to` (not when cancelled).
 */
export function runScrub(player: Scrubbable, plan: ScrubPlan, onDone: () => void): () => void {
  let raf = 0;
  let cancelled = false;
  let start = -1;
  let lastSeek = -Infinity;
  const setMode = (on: boolean) => {
    try {
      player.seekTolerance = on ? LOOSE : EXACT;
      player.scrubbingModeOptions = { scrubbingModeEnabled: on };
    } catch {
      // Older players without these: plain seeks.
    }
  };
  const finish = () => {
    setMode(false);
    player.currentTime = plan.to;
    onDone();
  };
  if (plan.ms <= 0) {
    // Already there (within a frame or two): nothing visible to scrub.
    onDone();
    return () => {};
  }
  setMode(true);
  const frame = (now: number) => {
    if (cancelled) return;
    if (start < 0) start = now;
    const elapsed = now - start;
    if (elapsed >= plan.ms) {
      finish();
      return;
    }
    if (now - lastSeek >= plan.stepMs - 4) {
      lastSeek = now;
      player.currentTime = scrubTimeAt(plan, elapsed);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(raf);
    setMode(false);
  };
}
