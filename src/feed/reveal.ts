/**
 * Timing for the info card's text reveal, matched to Apple's: the TextRenderer
 * transition in WWDC24's "Create custom visual effects with SwiftUI" (session
 * 10151, 15:50–20:10), whose code is on its slides and whose demo was measured
 * frame by frame at 4K. Pure, so it runs under `node --test`.
 *
 * Apple's transition, per unit (a line, or a glyph), `t` into the unit and
 * `p = t / 0.4 s`:
 *  - opacity  = easeIn(1.4 · p)               (in by ~0.29 s, starting slowly)
 *  - blur     = lineHeight / 16 · easeIn(1 − p) (about 1 px for our card text)
 *  - offset   = a spring from −descent (just above) to 0; it drops a little
 *               past its place (~24 % of the drop) and settles by ~0.33 s.
 * The units start one after another so the whole text takes 0.9 s, however
 * many units there are (`unitStep`), and the transition runs on a linear clock.
 *
 * Variants (dev settings → Double take → Text):
 *  - words (default): the transition per word;
 *  - lines: per line, as in Apple's first demo;
 *  - letters: per letter, as in Apple's final demo.
 */

export const REVEAL_VARIANTS = ['words', 'lines', 'letters'] as const;
export type RevealVariant = (typeof REVEAL_VARIANTS)[number];

/** What one unit is, per variant. */
export const REVEAL_UNIT: Record<RevealVariant, 'word' | 'line' | 'letter'> = {
  words: 'word',
  lines: 'line',
  letters: 'letter',
};

/** The whole reveal, ms (Apple's `duration = 0.9`). */
export const REVEAL_TOTAL_MS = 900;
/** One unit's own animation, ms (Apple's `elementDuration`). */
export const REVEAL_UNIT_MS = 400;

/**
 * Time between consecutive unit starts for `n` units (Apple's `elementDelay`):
 * spread so the last unit finishes as the whole reveal does.
 */
export function unitStep(n: number): number {
  if (n <= 1) return 0;
  return Math.max((REVEAL_TOTAL_MS - n * REVEAL_UNIT_MS) / (n + 1), (REVEAL_TOTAL_MS - REVEAL_UNIT_MS) / n);
}

/** When each of `n` units starts, ms. */
export function unitDelays(n: number): number[] {
  const step = unitStep(n);
  return Array.from({ length: Math.max(0, n) }, (_, i) => i * step);
}

/**
 * When the hint (the unit after `n` text units) starts, and when everything has
 * settled: the hint is paced as one more unit.
 */
export function revealSchedule(n: number): { hint: number; total: number } {
  const step = unitStep(n + 1);
  const hint = Math.max(0, n) * step;
  return { hint, total: hint + REVEAL_UNIT_MS };
}

/** CSS / SwiftUI ease-in, cubic-bezier(0.42, 0, 1, 1), for x in 0..1. */
export function easeIn(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Solve bx(s) = x for the curve parameter s (bx is increasing), then return by(s).
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

/** The drop's spring, fitted to Apple's demo: ~0.395 s response, damping ratio ~0.41. */
export const REVEAL_SPRING = { response: 395, damping: 0.41 };

function springRaw(t: number): number {
  'worklet';
  const w = (2 * Math.PI) / REVEAL_SPRING.response;
  const z = REVEAL_SPRING.damping;
  const wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/**
 * How far a unit still is from its place, as a fraction of its starting offset,
 * `t` ms into it: 1 at the start, dipping a little below 0 (the overshoot), and
 * exactly 0 from the end of the unit's time on (the spring's last fraction of a
 * pixel is folded in, so a stopped clock never leaves a word off its line).
 */
export function dropSpring(t: number): number {
  'worklet';
  if (t <= 0) return 1;
  if (t >= REVEAL_UNIT_MS) return 0;
  const k = t / REVEAL_UNIT_MS;
  return springRaw(t) - springRaw(REVEAL_UNIT_MS) * k * k * k;
}

/** A unit's type: how far it drops (its descent) and its strongest blur. */
export interface RevealMetrics {
  /** px; Apple drops each unit from its descent above its place. */
  descent: number;
  /** px; Apple's `lineHeight / 16`. */
  blur: number;
}

/** A unit's metrics from its text style's type size (SF's descent is about 0.24 em). */
export function revealMetrics(style?: { fontSize?: number; lineHeight?: number } | null): RevealMetrics {
  const size = style?.fontSize ?? 15;
  return { descent: 0.24 * size, blur: (style?.lineHeight ?? size * 1.25) / 16 };
}

export interface RevealFrame {
  opacity: number;
  translateY: number;
  /** Blur in px (desktop browsers only; too costly per word elsewhere, and about 1 px anyway). */
  blur: number;
}

/** One unit's look `ms` into the reveal, the unit starting at `delay`. */
export function revealFrame(ms: number, delay: number, m: RevealMetrics): RevealFrame {
  'worklet';
  const t = Math.min(REVEAL_UNIT_MS, Math.max(0, ms - delay));
  const p = t / REVEAL_UNIT_MS;
  return {
    opacity: easeIn(Math.min(1, 1.4 * p)),
    translateY: -m.descent * dropSpring(t),
    blur: m.blur * easeIn(1 - p),
  };
}

/** The words of a text, for word units (whitespace collapsed). */
export function revealWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** The letters of a word (whole graphemes, so emoji stay in one piece). */
export function revealLetters(word: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(word)].map((g) => g.segment);
  return Array.from(word);
}
