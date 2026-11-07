/**
 * Timing rules for tells.
 *
 * A box is drawn on one sampled frame. Things move, so the box is only shown
 * close to that frame, even when the note's claim covers a longer stretch.
 * Windows are also kept long enough to see: the player reports time every
 * 250 ms, so a 0-length window would flash or never show.
 */

/** Shortest window we publish (seconds). */
export const MIN_WINDOW = 1.0;
/** A boxed tell is shown at most this far either side of the frame it was drawn on. */
export const BOX_HALF_SPAN = 1.0;
/** A window covering at least this share of the clip isn't really timed. */
export const WHOLE_CLIP_SHARE = 0.8;

/**
 * Parse a time the way notes and models write it: 7, "7", "7s", "~2s",
 * "0:07", "00:07.5", "1:02:03", "around 2 seconds". Returns null when there is
 * no usable time.
 */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  const clock = /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?/.exec(s);
  if (clock) {
    const [, a, b, c, frac] = clock;
    const base = c !== undefined ? +a * 3600 + +b * 60 + +c : +a * 60 + +b;
    return base + (frac ? Number(`0.${frac}`) : 0);
  }
  const secs = /(\d+(?:\.\d+)?)\s*(?:s\b|sec|secs|second|seconds)?/.exec(s);
  return secs ? Number(secs[1]) : null;
}

/**
 * True when the text names a moment ("0:07", "at 2s", "around 7 seconds",
 * "~2s in"), not a duration ("the 10 second length", "10s long").
 */
export function mentionsTime(text: string): boolean {
  const duration = String.raw`(?![\s-]*(?:long|length|limit|clip|video|max|duration))`;
  return new RegExp(
    String.raw`\b\d{1,2}:\d{2}\b|~\s*\d+(?:\.\d+)?\s*s\b${duration}|\b\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds?)\b${duration}`,
    'i',
  ).test(text);
}

export interface WindowInput {
  t0: number | null;
  t1: number | null;
  /** Time of the sampled frame the box was drawn on, if any. */
  frameT?: number | null;
  /** A second moment to compare against (e.g. after the object vanished); kept inside the window. */
  compareT?: number | null;
  hasBox: boolean;
  duration: number;
}

export interface WindowResult {
  t0: number;
  t1: number;
  focusT: number;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Normalize a tell's window. Returns null when no time can be established at
 * all (no window, no frame) or the time is past the end of the clip.
 */
export function normalizeWindow(w: WindowInput): WindowResult | null {
  const notes: string[] = [];
  const dur = w.duration;
  if (!(dur > 0)) return null;
  let t0 = w.t0;
  let t1 = w.t1;
  const frameT = w.frameT ?? null;

  if (t0 !== null && t1 !== null && t1 < t0) {
    [t0, t1] = [t1, t0];
    notes.push('t0/t1 swapped');
  }
  if (t0 !== null && t0 >= dur) {
    if (frameT === null) return null;
    notes.push(`t0 ${t0}s is past the end (${dur}s); using the frame time`);
    t0 = t1 = null;
  }
  if (t0 === null && t1 !== null) t0 = t1;
  if (t0 !== null && t1 === null) t1 = t0;

  const wholeClip = t0 !== null && t1 !== null && t1 - t0 >= dur * WHOLE_CLIP_SHARE;
  if (wholeClip) notes.push('window spans most of the clip; treated as untimed');

  // Where to pause: the frame the box was drawn on, else the middle of the window.
  let focus: number;
  let contradicts = false;
  if (frameT !== null && frameT >= 0 && frameT <= dur) {
    if (t0 !== null && t1 !== null && !wholeClip && (frameT < t0 - 0.5 || frameT > t1 + 0.5)) {
      notes.push(`box frame at ${frameT}s is outside the claimed ${t0}–${t1}s; following the frame`);
      contradicts = true;
    }
    focus = frameT;
  } else if (t0 !== null && t1 !== null && !wholeClip) {
    focus = (t0 + t1) / 2;
  } else {
    return null; // nothing pins this to a moment
  }

  let a: number;
  let b: number;
  if (w.hasBox || wholeClip || t0 === null || t1 === null) {
    // A box belongs to its frame: stay near it.
    a = Math.max(0, focus - BOX_HALF_SPAN);
    b = Math.min(dur, focus + BOX_HALF_SPAN);
    if (!wholeClip && !contradicts && t0 !== null && t1 !== null) {
      // Prefer the claimed window where it overlaps the frame's neighbourhood.
      const ca = Math.max(a, Math.min(t0, focus));
      const cb = Math.min(b, Math.max(t1, focus));
      if (cb - ca >= MIN_WINDOW) [a, b] = [ca, cb];
    }
  } else {
    a = Math.max(0, t0);
    b = Math.min(dur, t1);
  }
  const cmp = w.compareT ?? null;
  if (cmp !== null && cmp >= 0 && cmp <= dur && cmp !== focus) {
    a = Math.max(0, Math.min(a, cmp - 0.3));
    b = Math.min(dur, Math.max(b, cmp + 0.3));
  }
  if (b - a < MIN_WINDOW) {
    const half = MIN_WINDOW / 2;
    a = Math.max(0, Math.min(focus - half, dur - MIN_WINDOW));
    b = Math.min(dur, a + MIN_WINDOW);
    notes.push(`window widened to ${MIN_WINDOW}s so it can be seen`);
  }
  focus = Math.min(b, Math.max(a, focus));
  return { t0: r2(a), t1: r2(b), focusT: r2(focus), notes };
}

/** ffmpeg scene scores at or above this count as a cut (fast action alone peaks around 0.4–0.6). */
export const CUT_SCORE = 0.5;

/** The shot holding time `t`: between the last cut at or before it and the next cut after it. */
export function shotAround(cuts: number[], t: number, duration: number): { t0: number; t1: number } {
  const before = cuts.filter((c) => c <= t + 1e-6);
  const after = cuts.filter((c) => c > t + 1e-6);
  return { t0: before.length ? Math.max(...before) : 0, t1: after.length ? Math.min(...after) : duration };
}

/**
 * Keep a tell inside the shot it was drawn in. A box belongs to one shot:
 * across a camera cut the same spot shows something else, and a before/after
 * pair that straddles a cut compares two different pictures. Returns the
 * tell unchanged when the clip has no cuts.
 */
export function fitToShot<T extends { t0: number; t1: number; focusT?: number; compareT?: number; shot?: { t0: number; t1: number } }>(
  tell: T,
  cuts: number[],
  duration: number,
): { tell: T; note: string | null } {
  if (!cuts.length) return { tell, note: null };
  const focus = tell.focusT ?? tell.t0;
  const shot = shotAround(cuts, focus, duration);
  const r = (n: number) => Math.round(n * 100) / 100;
  let t0 = Math.max(tell.t0, shot.t0);
  let t1 = Math.min(tell.t1, shot.t1);
  if (t1 - t0 < 0.05) [t0, t1] = [Math.max(shot.t0, focus - 0.05), Math.min(shot.t1, focus + 0.05)];
  const out: T = { ...tell, t0: r(t0), t1: r(t1), shot: { t0: r(shot.t0), t1: r(shot.t1) } };
  const notes: string[] = [];
  if (out.compareT !== undefined && (out.compareT < shot.t0 || out.compareT > shot.t1)) {
    delete out.compareT;
    notes.push(`after-frame ${tell.compareT}s is in another shot; dropped`);
  }
  if (out.focusT !== undefined) out.focusT = Math.min(out.t1, Math.max(out.t0, out.focusT));
  if (out.t0 !== tell.t0 || out.t1 !== tell.t1) notes.push(`window ${tell.t0}–${tell.t1}s trimmed to its shot (${out.t0}–${out.t1}s)`);
  return { tell: out, note: notes.length ? notes.join('; ') : null };
}
