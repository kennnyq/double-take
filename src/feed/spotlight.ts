/**
 * Geometry for the double take's spotlight: everything outside the area of
 * interest is darkened (and optionally blurred) through a hole shaped like
 * the dev settings ask (rectangle, rounded, ellipse, circle, feathered, blob).
 * Pure, so it runs under `node --test`; `Spotlight.tsx` (native) and
 * `Spotlight.web.tsx` draw it.
 *
 * Performance: the hole is a prepared soft-edged image (scripts/spotlight-masks.ts)
 * moved and scaled with transforms (native) or mask position/size (web), so a
 * moving spotlight never redraws or relayouts anything.
 */

/**
 * What the spotlight does outside the area, cheapest first:
 *  - off: nothing;
 *  - darken: dims it (the default: cheap everywhere);
 *  - cheapBlur: dims it over a blurred still of the loop (blurred once per step,
 *    the live video stays sharp inside the area);
 *  - fullBlur: dims it and live-blurs the playing video (expensive on iPhones).
 */
export const SPOTLIGHT_EFFECTS = ['off', 'darken', 'cheapBlur', 'fullBlur'] as const;
export type SpotlightEffect = (typeof SPOTLIGHT_EFFECTS)[number];

export const SPOTLIGHT_SHAPES = ['rect', 'rounded', 'ellipse', 'circle', 'feather', 'blob'] as const;
export type SpotlightShape = (typeof SPOTLIGHT_SHAPES)[number];

/** Breathing room around the tell's box, so the subject isn't hemmed in. */
export const SPOTLIGHT_PADDINGS = ['tight', 'normal', 'roomy'] as const;
export type SpotlightPadding = (typeof SPOTLIGHT_PADDINGS)[number];

/** Padding on each side of the box, px. */
export function paddingPx(p: SpotlightPadding): number {
  return p === 'tight' ? 8 : p === 'roomy' ? 36 : 22;
}

/** 1: light, 2: medium, 3: strong. */
export const SPOTLIGHT_STRENGTHS = [1, 2, 3] as const;
export type SpotlightStrength = (typeof SPOTLIGHT_STRENGTHS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The hole around a tell's area, in stage px. */
export interface Hole extends Rect {
  /** Soft edge width, px (keeps the info card clear of it). */
  feather: number;
}

/**
 * How dark the outside gets (0..1), and how much it's blurred (CSS px on web,
 * expo-blur intensity and expo-image radius on devices). Subtle by default:
 * the outside should recede, not disappear. With a blur on too, it dims less.
 */
export function spotlightStrength(
  level: SpotlightStrength,
  blurring = false,
): { dim: number; blurPx: number; intensity: number; stillBlur: number } {
  const s =
    level === 1
      ? { dim: 0.22, blurPx: 2, intensity: 12, stillBlur: 3 }
      : level === 3
        ? { dim: 0.55, blurPx: 9, intensity: 45, stillBlur: 10 }
        : { dim: 0.34, blurPx: 4, intensity: 22, stillBlur: 5 };
  return blurring ? { ...s, dim: s.dim * 0.7 } : s;
}

/** The smallest hole drawn, so a tiny box still reads as a spotlight. */
const MIN_SIDE = 44;

/** The hole around a tell's box (stage px) for a shape, `pad` px roomier on each side. Centred on the box; never smaller than MIN_SIDE. */
export function holeFor(box: Rect, shape: SpotlightShape, pad = paddingPx('normal')): Hole {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let w = box.w + 2 * pad;
  let h = box.h + 2 * pad;
  let feather = 0;
  switch (shape) {
    case 'rect':
      break;
    case 'rounded':
      feather = 4;
      break;
    case 'ellipse':
      // Through the box's corners, then the padding.
      w = box.w * Math.SQRT2 + 1.4 * pad;
      h = box.h * Math.SQRT2 + 1.4 * pad;
      feather = 14;
      break;
    case 'circle': {
      const d = Math.hypot(box.w, box.h) + 1.4 * pad;
      w = d;
      h = d;
      feather = 10;
      break;
    }
    case 'feather':
      feather = 28;
      break;
    case 'blob':
      w += 20;
      h += 20;
      feather = 40;
      break;
  }
  w = Math.max(MIN_SIDE, w);
  h = Math.max(MIN_SIDE, h);
  return { x: cx - w / 2, y: cy - h / 2, w, h, feather };
}

/** The hole grown (or shrunk, for negative `by`) on every side. */
export function grow(h: Hole, by: number): Hole {
  'worklet';
  const w = Math.max(2, h.w + 2 * by);
  const ht = Math.max(2, h.h + 2 * by);
  return { ...h, x: h.x + (h.w - w) / 2, y: h.y + (h.h - ht) / 2, w, h: ht };
}

// ---- the prepared soft-hole images ----------------------------------------------

/** Size of each mask image, and of the central square the shape fills. */
export const MASK_SIZE = 512;
export const MASK_BOX = 256;

export type MaskShape = { kind: 'ellipse'; feather: number } | { kind: 'rrect'; radius: number; feather: number };

/** The images (in MASK_BOX px): `node scripts/spotlight-masks.ts` writes hole-<name>.png and spot-<name>.png. */
export const MASK_SHAPES = {
  rect: { kind: 'rrect', radius: 0, feather: 2 },
  rounded: { kind: 'rrect', radius: 28, feather: 5 },
  ellipse: { kind: 'ellipse', feather: 22 },
  soft: { kind: 'rrect', radius: 44, feather: 48 },
  blob: { kind: 'ellipse', feather: 80 },
} as const satisfies Record<string, MaskShape>;
export type MaskName = keyof typeof MASK_SHAPES;

/** Which image draws a shape (a circle is a square hole drawn with the ellipse). */
export function maskFor(shape: SpotlightShape): MaskName {
  if (shape === 'circle') return 'ellipse';
  if (shape === 'feather') return 'soft';
  return shape;
}

/**
 * Where a mask image goes so its central box lands on the hole: its top-left
 * corner and size, in stage px (the image is MASK_SIZE / MASK_BOX times the hole).
 */
export function maskPlacement(h: Rect): Rect {
  'worklet';
  const k = MASK_SIZE / MASK_BOX;
  const w = h.w * k;
  const ht = h.h * k;
  return { x: h.x + h.w / 2 - w / 2, y: h.y + h.h / 2 - ht / 2, w, h: ht };
}

/**
 * Bands around a rectangular hole (top, bottom, left, right), clipped to the
 * stage: native's full blur uses these, since a blur view can't have a shaped hole.
 */
export function bands(stageW: number, stageH: number, hole: Rect): Rect[] {
  'worklet';
  const x0 = Math.min(stageW, Math.max(0, hole.x));
  const y0 = Math.min(stageH, Math.max(0, hole.y));
  const x1 = Math.max(x0, Math.min(stageW, hole.x + hole.w));
  const y1 = Math.max(y0, Math.min(stageH, hole.y + hole.h));
  return [
    { x: 0, y: 0, w: stageW, h: y0 },
    { x: 0, y: y1, w: stageW, h: stageH - y1 },
    { x: 0, y: y0, w: x0, h: y1 - y0 },
    { x: x1, y: y0, w: stageW - x1, h: y1 - y0 },
  ];
}

export interface ClipTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

/**
 * The transform that maps a stage-sized view onto `r` (translate, then scale
 * about its centre), and the inverse for its child, so the child stays put
 * while the parent's clip shrinks to `r`: native's cheap blur shows the live
 * video only inside the area this way, with transforms alone.
 */
export function clipTransforms(stageW: number, stageH: number, r: Rect): { outer: ClipTransform; inner: ClipTransform } {
  'worklet';
  const sx = Math.max(1e-3, r.w / stageW);
  const sy = Math.max(1e-3, r.h / stageH);
  const tx = r.x + r.w / 2 - stageW / 2;
  const ty = r.y + r.h / 2 - stageH / 2;
  return {
    outer: { tx, ty, sx, sy },
    inner: { tx: -tx / sx, ty: -ty / sy, sx: 1 / sx, sy: 1 / sy },
  };
}
