/**
 * Geometry for the double take's spotlight: everything outside the area of
 * interest is darkened and/or blurred, through a hole shaped like the dev
 * settings ask (rectangle, rounded, ellipse, circle, feathered, blob). Pure,
 * so it runs under `node --test`; `Spotlight.tsx` (native) and
 * `Spotlight.web.tsx` draw it.
 */

export const SPOTLIGHT_MODES = ['darken', 'blur', 'both'] as const;
export type SpotlightMode = (typeof SPOTLIGHT_MODES)[number];

export const SPOTLIGHT_SHAPES = ['rect', 'rounded', 'ellipse', 'circle', 'feather', 'blob'] as const;
export type SpotlightShape = (typeof SPOTLIGHT_SHAPES)[number];

/** 1: light, 2: medium, 3: strong. */
export const SPOTLIGHT_STRENGTHS = [1, 2, 3] as const;
export type SpotlightStrength = (typeof SPOTLIGHT_STRENGTHS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The hole: a rounded rectangle (`radius`, clamped to half the short side) or an ellipse, with a soft edge `feather` px wide. */
export interface Hole extends Rect {
  radius: number;
  ellipse: boolean;
  feather: number;
}

/** How dark the outside gets (0..1) and how much it's blurred (CSS px on web, expo-blur intensity on devices). */
export function spotlightStrength(level: SpotlightStrength): { dim: number; blurPx: number; intensity: number } {
  if (level === 1) return { dim: 0.32, blurPx: 4, intensity: 22 };
  if (level === 3) return { dim: 0.66, blurPx: 14, intensity: 65 };
  return { dim: 0.5, blurPx: 8, intensity: 40 };
}

/** The smallest hole drawn, so a tiny box still reads as a spotlight. */
const MIN_SIDE = 44;

/** The hole around a tell's box (stage px) for a shape. Centred on the box; never smaller than MIN_SIDE. */
export function holeFor(box: Rect, shape: SpotlightShape): Hole {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let w = box.w;
  let h = box.h;
  let radius = 0;
  let ellipse = false;
  let feather = 0;
  switch (shape) {
    case 'rect':
      w += 8;
      h += 8;
      break;
    case 'rounded':
      w += 16;
      h += 16;
      radius = 14;
      feather = 4;
      break;
    case 'ellipse':
      // Through the box's corners, a little loose.
      w = w * Math.SQRT2 + 8;
      h = h * Math.SQRT2 + 8;
      ellipse = true;
      feather = 14;
      break;
    case 'circle': {
      const d = Math.hypot(w, h) + 8;
      w = d;
      h = d;
      ellipse = true;
      feather = 10;
      break;
    }
    case 'feather':
      w += 24;
      h += 24;
      radius = 20;
      feather = 28;
      break;
    case 'blob':
      // A padded capsule with a very soft edge.
      w += 40;
      h += 40;
      radius = Math.min(w, h) / 2;
      feather = 40;
      break;
  }
  w = Math.max(MIN_SIDE, w);
  h = Math.max(MIN_SIDE, h);
  return { x: cx - w / 2, y: cy - h / 2, w, h, radius: Math.min(radius, w / 2, h / 2), ellipse, feather };
}

/** The hole grown (or shrunk, for negative `by`) on every side; the radius follows, so the edges stay parallel. */
export function grow(h: Hole, by: number): Hole {
  'worklet';
  const w = Math.max(2, h.w + 2 * by);
  const ht = Math.max(2, h.h + 2 * by);
  return {
    ...h,
    x: h.x + (h.w - w) / 2,
    y: h.y + (h.h - ht) / 2,
    w,
    h: ht,
    radius: Math.max(0, Math.min(h.radius + by, w / 2, ht / 2)),
  };
}

/**
 * The dimming as stacked layers, each a full cover with a hole. A soft edge is
 * `n` layers with holes spread across the feather, inner first; their alphas
 * are chosen so that, stacked, the darkness rises evenly from nothing inside
 * the hole to `dim` outside it.
 */
export function featherLayers(hole: Hole, dim: number, n = 5): { hole: Hole; alpha: number }[] {
  'worklet';
  if (hole.feather <= 0 || n <= 1) return [{ hole, alpha: dim }];
  const out: { hole: Hole; alpha: number }[] = [];
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const cumulative = (dim * (k + 1)) / n;
    const alpha = 1 - (1 - cumulative) / (1 - prev);
    prev = cumulative;
    out.push({ hole: grow(hole, hole.feather * (k / (n - 1) - 0.5)), alpha });
  }
  return out;
}

/** The alpha of stacked layers at a point covered by the first `count` of them (for tests). */
export function stackedAlpha(alphas: number[]): number {
  return 1 - alphas.reduce((keep, a) => keep * (1 - a), 1);
}

/** A hole big enough to take in the whole stage: where the spotlight opens from and closes to. */
export function openHole(stageW: number, stageH: number, like: Hole): Hole {
  'worklet';
  const pad = Math.max(stageW, stageH) * 0.6 + like.feather;
  return { ...like, x: -pad, y: -pad, w: stageW + 2 * pad, h: stageH + 2 * pad, radius: like.ellipse ? 0 : like.radius };
}

/** Interpolate between two holes (`t` may overshoot a little, for springs). */
export function mixHole(a: Hole, b: Hole, t: number): Hole {
  'worklet';
  const m = (p: number, q: number) => p + (q - p) * t;
  return { x: m(a.x, b.x), y: m(a.y, b.y), w: m(a.w, b.w), h: m(a.h, b.h), radius: m(a.radius, b.radius), ellipse: b.ellipse, feather: m(a.feather, b.feather) };
}

function n(v: number): number {
  'worklet';
  return Math.round(v * 10) / 10;
}

/** The hole's outline as an SVG subpath (rounded rect or ellipse). */
export function holeSubpath(hole: Hole): string {
  'worklet';
  const { x, y, w, h } = hole;
  if (hole.ellipse) {
    const rx = w / 2;
    const ry = h / 2;
    const cy = y + ry;
    return `M${n(x)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(x + w)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(x)} ${n(cy)}Z`;
  }
  const r = Math.max(0, Math.min(hole.radius, w / 2, h / 2));
  if (r <= 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  return (
    `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}` +
    `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
  );
}

/**
 * An SVG path covering the stage except the hole, for `clip-path: path(evenodd, …)`
 * on web: the outer rectangle, then the hole (rounded rect or ellipse).
 */
export function holePath(stageW: number, stageH: number, hole: Hole): string {
  'worklet';
  return `M0 0H${n(stageW)}V${n(stageH)}H0Z${holeSubpath(hole)}`;
}

/**
 * An SVG image of the stage, opaque except the hole, whose edge is softened
 * by a Gaussian blur across the hole's feather: a CSS mask for the web
 * spotlight's dim and blur layers (one layer each, with a smooth edge).
 */
export function holeMaskSvg(stageW: number, stageH: number, hole: Hole): string {
  'worklet';
  const pad = 200;
  const W = Math.round(stageW);
  const H = Math.round(stageH);
  const outer = `M${-pad} ${-pad}H${W + pad}V${H + pad}H${-pad}Z`;
  // About ±2σ spans the feather.
  const sigma = hole.feather / 4;
  const filter =
    sigma > 0.3
      ? `<filter id="f" x="${-pad}" y="${-pad}" width="${W + 2 * pad}" height="${H + 2 * pad}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${n(sigma)}"/></filter>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${filter}` +
    `<path fill="#fff" fill-rule="evenodd" d="${outer}${holeSubpath(hole)}"${filter ? ' filter="url(#f)"' : ''}/></svg>`
  );
}

/**
 * Bands around a rectangular hole (top, bottom, left, right), clipped to the
 * stage: native blurs these, since a blur view can't have a shaped hole.
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
