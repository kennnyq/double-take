/**
 * Coordinate handling between what a vision model sees and the app's boxes.
 *
 * Spaces involved:
 *  - **model space**: `bbox_2d = [x1, y1, x2, y2]` normalized to 0..1000 on the
 *    image the model was sent (Nemotron VL's grounding convention).
 *  - **crop**: frames may be cropped before sending (e.g. letterbox bars cut
 *    off), so the image the model saw is a sub-rectangle of the video frame.
 *  - **frame space**: the app's `Box`, fractions of the full, uncropped frame.
 *    How that frame is then fitted to the screen (contain/cover) is handled
 *    in src/feed/tells.ts.
 */
import type { Box } from './format.ts';

export type BBox = [number, number, number, number];

export interface BBoxResult {
  box: Box | null;
  /** Problems fixed or found, for the run report. */
  notes: string[];
}

/** Boxes covering more than this share of the frame aren't a localization. */
export const MAX_BOX_AREA = 0.6;
/** Smallest box side we draw (fraction of the frame); tinier boxes are grown around their centre. */
export const MIN_BOX_SIDE = 0.06;
/** How far outside 0..1000 a coordinate may stray and still be clamped rather than rejected. */
const CLAMP_SLACK = 25;

/**
 * Turn a model's `bbox_2d` into a frame-space box, or reject it.
 *
 * `pixelSize` is the size of the image the model saw, used only to rescue
 * boxes given in pixels. `crop` maps that image back into the full frame.
 */
export function bboxToBox(raw: unknown, opts: { pixelSize?: { w: number; h: number }; crop?: Box } = {}): BBoxResult {
  const notes: string[] = [];
  if (!Array.isArray(raw) || raw.length !== 4) return { box: null, notes: ['bbox is not 4 numbers'] };
  let v = raw.map((n) => (typeof n === 'string' ? Number(n) : n)) as unknown[];
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return { box: null, notes: ['bbox has non-numeric values'] };
  let [x1, y1, x2, y2] = v as number[];

  // Scale detection. 0..1 fractions and pixel coordinates both show up in practice.
  const max = Math.max(x1, y1, x2, y2);
  if (max <= 1 && Math.max(x2 - x1, y2 - y1) > 0) {
    notes.push('bbox looked like 0..1 fractions; rescaled to 0..1000');
    [x1, y1, x2, y2] = [x1, y1, x2, y2].map((n) => n * 1000);
  } else if (max > 1000 + CLAMP_SLACK) {
    const px = opts.pixelSize;
    if (px && x2 <= px.w + 1 && x1 <= px.w + 1 && y1 <= px.h + 1 && y2 <= px.h + 1) {
      notes.push(`bbox looked like pixels on a ${px.w}x${px.h} image; rescaled`);
      [x1, x2] = [x1, x2].map((n) => (n / px.w) * 1000);
      [y1, y2] = [y1, y2].map((n) => (n / px.h) * 1000);
    } else {
      return { box: null, notes: [`bbox ${JSON.stringify(raw)} is outside 0..1000`] };
    }
  }
  if (x2 < x1) {
    [x1, x2] = [x2, x1];
    notes.push('bbox x1/x2 swapped');
  }
  if (y2 < y1) {
    [y1, y2] = [y2, y1];
    notes.push('bbox y1/y2 swapped');
  }
  if (Math.min(x1, y1) < -CLAMP_SLACK || Math.max(x2, y2) > 1000 + CLAMP_SLACK) {
    return { box: null, notes: [`bbox ${JSON.stringify(raw)} is outside 0..1000`] };
  }
  v = [x1, y1, x2, y2].map((n) => Math.min(1000, Math.max(0, n)));
  [x1, y1, x2, y2] = v as number[];

  let box: Box = { x: x1 / 1000, y: y1 / 1000, w: (x2 - x1) / 1000, h: (y2 - y1) / 1000 };
  if (opts.crop) box = cropToFrame(box, opts.crop);

  if (box.w * box.h > MAX_BOX_AREA) {
    return { box: null, notes: [...notes, `bbox covers ${Math.round(box.w * box.h * 100)}% of the frame, not a localization`] };
  }
  if (box.w <= 0 && box.h <= 0) return { box: null, notes: [...notes, 'bbox has no area'] };
  const grown = growToMin(box);
  if (grown !== box) notes.push('bbox was tiny; grown around its centre so it can be seen');
  return { box: round(grown), notes };
}

/** Map a box from a cropped image back into the full frame. */
export function cropToFrame(b: Box, crop: Box): Box {
  return { x: crop.x + b.x * crop.w, y: crop.y + b.y * crop.h, w: b.w * crop.w, h: b.h * crop.h };
}

/** Inverse of `cropToFrame`, clipped to the crop. Null when the box is outside it. */
export function frameToCrop(b: Box, crop: Box): Box | null {
  const x0 = Math.max(b.x, crop.x);
  const y0 = Math.max(b.y, crop.y);
  const x1 = Math.min(b.x + b.w, crop.x + crop.w);
  const y1 = Math.min(b.y + b.h, crop.y + crop.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: (x0 - crop.x) / crop.w, y: (y0 - crop.y) / crop.h, w: (x1 - x0) / crop.w, h: (y1 - y0) / crop.h };
}

function growToMin(b: Box): Box {
  if (b.w >= MIN_BOX_SIDE && b.h >= MIN_BOX_SIDE) return b;
  const w = Math.max(b.w, MIN_BOX_SIDE);
  const h = Math.max(b.h, MIN_BOX_SIDE);
  const x = Math.min(1 - w, Math.max(0, b.x + b.w / 2 - w / 2));
  const y = Math.min(1 - h, Math.max(0, b.y + b.h / 2 - h / 2));
  return { x, y, w, h };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
function round(b: Box): Box {
  const x = r4(b.x);
  const y = r4(b.y);
  // Keep x + w ≤ 1 after rounding.
  return { x, y, w: Math.min(r4(b.w), r4(1 - x)), h: Math.min(r4(b.h), r4(1 - y)) };
}

/** Intersection over union of two boxes. */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Letterbox detection result from ffmpeg `cropdetect` (`w:h:x:y` in pixels) as
 * a frame-space crop. Ignores crops that remove less than 3% (noise) and
 * returns undefined for a full frame.
 */
export function cropFromDetect(spec: string, frameW: number, frameH: number): Box | undefined {
  const m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(spec.trim());
  if (!m || frameW <= 0 || frameH <= 0) return undefined;
  const [w, h, x, y] = m.slice(1).map(Number);
  if (w <= 0 || h <= 0 || x + w > frameW || y + h > frameH) return undefined;
  if (w * h >= frameW * frameH * 0.97) return undefined;
  // Bars trim one axis. Cropping both heavily, or leaving under 15% of the
  // frame, usually means a dark scene rather than bars.
  if ((w < frameW * 0.6 && h < frameH * 0.6) || w * h < frameW * frameH * 0.15) return undefined;
  return { x: x / frameW, y: y / frameH, w: w / frameW, h: h / frameH };
}
