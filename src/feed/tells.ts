/**
 * Geometry and timing for tell overlays. Pure, so it runs under `node --test`.
 *
 * Tell boxes are stored as fractions of the video frame (see
 * scripts/harvest/tells/). On screen the frame is scaled to the stage with
 * `contain` (letterboxed) or `cover` (cropped), so boxes map through the same
 * transform the video does.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tell {
  id: string;
  category: string;
  label: string;
  detail?: string;
  t0: number;
  t1: number;
  box: Box;
}

export type Fit = 'contain' | 'cover';

/** Portrait-ish clips fill the screen; anything wider is shown whole. */
export function fitFor(aspect: number | undefined): Fit {
  return aspect !== undefined && aspect > 0.75 ? 'contain' : 'cover';
}

/** Where the video frame lands inside a stage, in stage pixels (may overflow for cover). */
export function videoRect(stageW: number, stageH: number, aspect: number, fit: Fit): Box {
  const stageAspect = stageW / stageH;
  const fitWidth = fit === 'contain' ? aspect > stageAspect : aspect < stageAspect;
  const w = fitWidth ? stageW : stageH * aspect;
  const h = fitWidth ? stageW / aspect : stageH;
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

/** A tell's box in stage pixels, clipped to the visible stage. */
export function boxOnStage(box: Box, frame: Box, stageW: number, stageH: number): Box | null {
  const x0 = Math.max(0, frame.x + box.x * frame.w);
  const y0 = Math.max(0, frame.y + box.y * frame.h);
  const x1 = Math.min(stageW, frame.x + (box.x + box.w) * frame.w);
  const y1 = Math.min(stageH, frame.y + (box.y + box.h) * frame.h);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null; // cropped away
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Tells to show at playback time `t`. A little slack either side, because
 * `timeUpdate` only arrives every 250 ms.
 */
export function activeTells(tells: Tell[], t: number, slack = TELL_SLACK): Tell[] {
  return tells.filter((x) => t >= x.t0 - slack && t <= x.t1 + slack);
}

/** Seconds of slack around each tell's window (see `activeTells`). */
export const TELL_SLACK = 0.3;

/**
 * Where "reveal" seeks to: a beat before the first tell, but inside its window,
 * so a paused clip already shows the box.
 */
export function revealTime(tells: Tell[]): number {
  return Math.max(0, Math.min(...tells.map((t) => t.t0)) - TELL_SLACK / 2);
}

/** Keep only well-formed tells; the file comes from the network. */
export function parseTells(data: unknown): Tell[] {
  const list = (data as { tells?: unknown })?.tells;
  if (!Array.isArray(list)) return [];
  return list.filter((t): t is Tell => {
    const b = t?.box;
    return (
      typeof t?.label === 'string' &&
      Number.isFinite(t.t0) &&
      Number.isFinite(t.t1) &&
      t.t1 > t.t0 &&
      [b?.x, b?.y, b?.w, b?.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    );
  });
}
