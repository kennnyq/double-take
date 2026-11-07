/**
 * A cheap, deterministic check on "X vanishes / changes" tells: compare the
 * pixels inside the box across sampled frames.
 *
 * It isn't proof: camera motion and people walking through the box also change
 * pixels. But it reliably catches two failure modes seen in live runs:
 *  - the model's `after_frame` is one frame too early (the dresser is still
 *    there at 6.0 s and gone at 6.5 s), so "After" would show no change;
 *  - the claimed change never happens in that region (the ceiling detector the
 *    note says "disappears completely" is visible in every frame).
 *
 * Calibrated on x-2106432142217765020 (2026-11-07): the region's mean absolute
 * grey difference went 1.6 → 15.4 when the dresser vanished, and stayed ≤ 5.6
 * for the detector across 2.5 s.
 */
import type { Box, Tell } from './format.ts';

export interface GrayFrame {
  t: number;
  w: number;
  h: number;
  /** 8-bit luma, row-major, w*h bytes. */
  px: Uint8Array;
}

/** Mean absolute difference inside a region counts as a change at or above this (0–255 scale). */
export const CHANGE_MIN = 8;
/** …and when it's at least this share of the change across the rest of the frame. */
export const CHANGE_VS_SCENE = 0.5;
/** Below this everywhere, the region didn't visibly change. */
export const STILL_MAX = 6;
/**
 * Above this whole-scene difference the camera moved too much for "the same
 * box" to mean the same spot. Calibrated 2026-11-07: a handheld selfie and a
 * steady dashcam stayed at 10–20; a bike POV swinging through a crash hit 40–70.
 */
export const MAX_SCENE_CHANGE = 30;

export function regionDiff(a: GrayFrame, b: GrayFrame, box: Box): { inside: number; outside: number } {
  if (a.w !== b.w || a.h !== b.h) throw new Error('frames differ in size');
  const x0 = Math.floor(box.x * a.w);
  const x1 = Math.max(x0 + 1, Math.ceil((box.x + box.w) * a.w));
  const y0 = Math.floor(box.y * a.h);
  const y1 = Math.max(y0 + 1, Math.ceil((box.y + box.h) * a.h));
  let din = 0;
  let nin = 0;
  let dout = 0;
  let nout = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      const d = Math.abs(a.px[i] - b.px[i]);
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        din += d;
        nin++;
      } else {
        dout += d;
        nout++;
      }
    }
  }
  return { inside: nin ? din / nin : 0, outside: nout ? dout / nout : 0 };
}

export interface ChangeResult {
  /** First frame (in the search direction) where the region changed; null if none did. */
  changeT: number | null;
  /** True when the region stayed still in every compared frame. */
  unchanged: boolean;
  /** True when the whole scene changed too much (camera motion) to compare any frame. */
  unstable?: boolean;
  samples: { t: number; inside: number; outside: number }[];
}

/**
 * Look for the moment the boxed region changes, starting from the frame the
 * box was drawn on and moving `direction` (+1 later, -1 earlier) up to
 * `maxGap` seconds.
 */
export function findChange(frames: GrayFrame[], focusT: number, box: Box, { direction = 1, maxGap = 3 } = {}): ChangeResult {
  const base = frames.reduce<GrayFrame | undefined>((best, f) => (!best || Math.abs(f.t - focusT) < Math.abs(best.t - focusT) ? f : best), undefined);
  if (!base || Math.abs(base.t - focusT) > 0.15) return { changeT: null, unchanged: false, samples: [] };
  const candidates = frames
    .filter((f) => (direction > 0 ? f.t > base.t : f.t < base.t) && Math.abs(f.t - base.t) <= maxGap + 1e-9)
    .sort((a, b) => direction * (a.t - b.t));
  const samples = candidates.map((f) => ({ t: f.t, ...regionDiff(base, f, box) }));
  const stable = samples.filter((s) => s.outside < MAX_SCENE_CHANGE);
  if (samples.length && !stable.length) return { changeT: null, unchanged: false, unstable: true, samples };
  const hit = stable.find((s) => s.inside >= CHANGE_MIN && s.inside >= CHANGE_VS_SCENE * s.outside);
  return {
    changeT: hit?.t ?? null,
    unchanged: stable.length > 0 && stable.every((s) => s.inside < STILL_MAX),
    samples,
  };
}

/** Categories whose claims are about something changing over time. */
const CHANGE_CATEGORIES = new Set(['continuity', 'object_morph', 'background_shift']);

/** Should this tell get a pixel check? Boxed, and either a before/after or a change-type claim. */
export const wantsChangeCheck = (t: Tell) => !!t.box && t.focusT !== undefined && (t.compareT !== undefined || CHANGE_CATEGORIES.has(t.category));

/**
 * Fold a pixel check into a tell:
 *  - a change found: it becomes the "after" moment (window widened to include it);
 *  - the region stayed still: no before/after, confidence low, flagged for the viewer;
 *  - inconclusive (something moved, but so did the scene): left as the model had it.
 */
export function applyChangeCheck(t: Tell, r: ChangeResult, duration: number): { tell: Tell; note: string | null } {
  if (r.changeT !== null) {
    const changeT = r.changeT;
    const t0 = Math.max(0, Math.min(t.t0, changeT - 0.3));
    const t1 = Math.min(duration, Math.max(t.t1, changeT + 0.3));
    const moved = t.compareT !== undefined && Math.abs(t.compareT - changeT) > 0.05;
    const note = t.compareT === undefined
      ? `pixel check: region changes at ${changeT}s; added as the after moment`
      : moved
        ? `pixel check: region unchanged at the model's ${t.compareT}s, changes at ${changeT}s; using ${changeT}s`
        : null;
    return { tell: { ...t, t0: round2(t0), t1: round2(t1), compareT: changeT, pixelCheck: 'changed' }, note };
  }
  if (r.unstable) {
    if (t.compareT === undefined) return { tell: t, note: null };
    const { compareT: _drop, ...rest } = t;
    return { tell: rest, note: 'pixel check: the camera moves too much to compare the same spot; before/after dropped' };
  }
  if (r.unchanged) {
    const { compareT: _drop, ...rest } = t;
    const max = Math.max(...r.samples.map((s) => s.inside)).toFixed(1);
    return {
      tell: { ...rest, pixelCheck: 'unchanged', confidence: 'low' },
      note: `pixel check: region barely changes (max diff ${max} over ${r.samples.length} frames); claim flagged`,
    };
  }
  return { tell: t, note: null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
