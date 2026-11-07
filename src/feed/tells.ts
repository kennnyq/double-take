/**
 * Geometry and timing for tell overlays. Pure, so it runs under `node --test`.
 *
 * Tell boxes are stored as fractions of the video frame (see
 * scripts/harvest/tells/). On screen the frame is scaled to the stage with
 * `contain` (letterboxed) or `cover` (cropped), so boxes map through the same
 * transform the video does.
 */

import { readTellsFile, type Box, type Tell } from '../annotations/format.ts';
import { TELL_SLACK, activeTells } from '../annotations/walkthrough.ts';

export type { Box, Tell };
export { TELL_SLACK, activeTells };

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
 * Where "reveal" seeks to: a beat before the first tell, but inside its window,
 * so a paused clip already shows the box.
 */
export function revealTime(tells: Tell[]): number {
  return Math.max(0, Math.min(...tells.map((t) => t.t0)) - TELL_SLACK / 2);
}

/** Keep only well-formed tells (v1 or v2 files); the file comes from the network. */
export function parseTells(data: unknown): Tell[] {
  return readTellsFile(data).tells;
}

/**
 * Where the walkthrough card goes: at the bottom unless the highlighted box
 * would sit under it, then at the top (below `topInset`, the top bar).
 */
export function cardPlacement(box: Box | null, stageH: number, cardH: number, topInset: number): 'top' | 'bottom' {
  if (!box) return 'bottom';
  const bottomCardTop = stageH - cardH - 16;
  if (box.y + box.h <= bottomCardTop) return 'bottom';
  const topCardBottom = topInset + cardH;
  // Prefer whichever position covers less of the box.
  const coverBottom = Math.max(0, box.y + box.h - bottomCardTop);
  const coverTop = Math.max(0, topCardBottom - box.y);
  return coverTop < coverBottom ? 'top' : 'bottom';
}
