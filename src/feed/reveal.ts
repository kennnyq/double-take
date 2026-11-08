/**
 * Timing for the info card's text reveal. Pure, so it runs under `node --test`.
 *
 * Two variants (dev settings → Double take → Text):
 *
 *  - siri (default): the Siri answer card in iOS 26, measured frame by frame
 *    from a 60 fps screen recording (each line tracked to the pixel). Each
 *    line starts about 1.2 line heights below its place (each line a little
 *    further than the one above) and rises on a gentle spring (damping 0.66,
 *    response 0.5 s: ~6 % past its place and back, settled by ~0.52 s). Lines
 *    start 20 ms apart, so the gaps between them start wide and close up. The
 *    words fade in (no blur) as their line starts moving, in reading order (a
 *    little later across the line, ~25 ms over its width), on a quartic
 *    ease-out over 0.55 s.
 *
 *  - wwdc: the TextRenderer transition from WWDC24's "Create custom visual
 *    effects with SwiftUI" (session 10151), per word: each fades in on an
 *    ease-in while it drops from its descent above into place on a bouncy
 *    spring, with a blur of lineHeight / 16; the units are paced so the whole
 *    text takes 0.9 s.
 *
 * Each word gets a `RevealUnit`: when its line starts moving, when it starts
 * fading, and how far it travels.
 */

export const REVEAL_VARIANTS = ['siri', 'wwdc'] as const;
export type RevealVariant = (typeof REVEAL_VARIANTS)[number];

/** One word's (or the hint's) timing and travel. */
export interface RevealUnit {
  /** When it starts moving, ms. */
  move: number;
  /** When it starts fading in, ms. */
  fade: number;
  /** siri: where it starts, in line heights below its place. */
  rise?: number;
}

/** A text style's reveal metrics, px. */
export interface RevealMetrics {
  lineHeight: number;
  /** The font's descent (about 0.24 em). */
  descent: number;
}

export function revealMetrics(style?: { fontSize?: number; lineHeight?: number } | null): RevealMetrics {
  const size = style?.fontSize ?? 15;
  return { lineHeight: style?.lineHeight ?? size * 1.25, descent: 0.24 * size };
}

/** A damped spring's distance from its target, 1 → 0, `t` ms in (SwiftUI's damping / response). */
export function dampedSpring(t: number, damping: number, response: number): number {
  'worklet';
  if (t <= 0) return 1;
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - damping * damping);
  return Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

/** `dampedSpring`, its last fraction folded in so it's exactly 0 from `end` on (a stopped clock never leaves a word off its line). */
function springTo(t: number, damping: number, response: number, end: number): number {
  'worklet';
  if (t <= 0) return 1;
  if (t >= end) return 0;
  const k = t / end;
  return dampedSpring(t, damping, response) - dampedSpring(end, damping, response) * k * k * k;
}

// ---- siri -------------------------------------------------------------------

export const SIRI = {
  /** Between one line's start and the next's, ms. */
  lineStagger: 20,
  /** Where the first line starts, in line heights below its place… */
  rise: 1.17,
  /** …and how much further each next line starts. */
  riseStep: 0.03,
  damping: 0.66,
  response: 500,
  /** By when the rise has settled, ms (its last fraction of a pixel is folded in). */
  settle: 620,
  /** A word starts fading this long after its line starts moving, ms… */
  fadeDelay: 0,
  /** …plus this much across the line's full width (left to right), ms. */
  sweep: 25,
  /** The fade's length, ms (quartic ease-out). */
  fadeMs: 550,
};

/** A word's timing, siri style, from its line and where it sits along the line (0 left … 1 right). */
export function siriUnit(line: number, x: number): RevealUnit {
  const move = line * SIRI.lineStagger;
  return { move, fade: move + SIRI.fadeDelay + SIRI.sweep * Math.min(1, Math.max(0, x)), rise: SIRI.rise + SIRI.riseStep * line };
}

// ---- wwdc -------------------------------------------------------------------

/** The whole reveal, ms (Apple's `duration = 0.9`). */
export const WWDC_TOTAL_MS = 900;
/** One unit's own animation, ms (Apple's `elementDuration`). */
export const WWDC_UNIT_MS = 400;
/** The drop's spring, fitted to Apple's demo. */
const WWDC_SPRING = { damping: 0.41, response: 395 };

/** Time between unit starts for `n` units (Apple's `elementDelay`): the last one finishes at 0.9 s. */
export function wwdcStep(n: number): number {
  if (n <= 1) return 0;
  return Math.max((WWDC_TOTAL_MS - n * WWDC_UNIT_MS) / (n + 1), (WWDC_TOTAL_MS - WWDC_UNIT_MS) / n);
}

/** CSS / SwiftUI ease-in, cubic-bezier(0.42, 0, 1, 1), for x in 0..1. */
export function easeIn(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let s = x;
  for (let i = 0; i < 14; i++) {
    const bx = 3 * (1 - s) * (1 - s) * s * 0.42 + 3 * (1 - s) * s * s + s * s * s;
    if (bx < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return 3 * s * s - 2 * s * s * s;
}

// ---- both -------------------------------------------------------------------

/**
 * Every word's timing, and the hint's (which comes in as one more line, or
 * one more unit), for words laid out on `lines` (each word's line index) at
 * `xs` (each word's position along its line, 0..1).
 */
export function revealPlan(variant: RevealVariant, lines: number[], xs: number[]): { units: RevealUnit[]; hint: RevealUnit; total: number } {
  if (variant === 'wwdc') {
    const n = lines.length;
    const step = wwdcStep(n + 1);
    const units = lines.map((_, i) => ({ move: i * step, fade: i * step }));
    const hint = { move: n * step, fade: n * step };
    return { units, hint, total: hint.move + WWDC_UNIT_MS };
  }
  const units = lines.map((l, i) => siriUnit(l, xs[i] ?? 0));
  const hint = siriUnit(lines.length ? Math.max(...lines) + 1 : 0, 0);
  return { units, hint, total: Math.max(hint.move + SIRI.settle, hint.fade + SIRI.fadeMs) };
}

export interface RevealFrame {
  opacity: number;
  translateY: number;
  /** Blur in px (wwdc, desktop browsers only). */
  blur: number;
}

/** One word's look `ms` into the reveal. */
export function revealFrame(variant: RevealVariant, ms: number, u: RevealUnit, m: RevealMetrics): RevealFrame {
  'worklet';
  if (variant === 'wwdc') {
    const t = Math.min(WWDC_UNIT_MS, Math.max(0, ms - u.move));
    const p = t / WWDC_UNIT_MS;
    return {
      opacity: easeIn(Math.min(1, 1.4 * p)),
      translateY: -m.descent * springTo(t, WWDC_SPRING.damping, WWDC_SPRING.response, WWDC_UNIT_MS),
      blur: (m.lineHeight / 16) * easeIn(1 - p),
    };
  }
  const f = Math.min(1, Math.max(0, (ms - u.fade) / SIRI.fadeMs));
  const out = (1 - f) * (1 - f);
  return {
    opacity: 1 - out * out,
    translateY: (u.rise ?? SIRI.rise) * m.lineHeight * springTo(ms - u.move, SIRI.damping, SIRI.response, SIRI.settle),
    blur: 0,
  };
}

/** The words of a text (whitespace collapsed). */
export function revealWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Line indexes from each word's top, px (words within a few px of each other share a line). */
export function linesFromTops(tops: number[]): number[] {
  const rows: number[] = [];
  for (const t of [...tops].sort((a, b) => a - b)) if (!rows.length || t - rows[rows.length - 1] > 4) rows.push(t);
  return tops.map((t) => rows.filter((r) => t - r > -4).length - 1);
}
