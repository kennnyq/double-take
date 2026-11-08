/**
 * Timing for the info card's text reveal, modelled on Apple's: the TextRenderer
 * demo in WWDC24's "Create custom visual effects with SwiftUI" (studied frame
 * by frame) and the Siri / Apple Intelligence answer card. Each unit (word or
 * line) starts blurred and a few points off, then settles into place on a
 * spring with no overshoot while the blur clears and it fades in quickly; the
 * units start one after another at an even pace. In Apple's demo each line
 * drops into place from just above (by its descender), is sharp after about
 * 270 ms, and the whole text takes about 0.9 s. Pure, so it runs under
 * `node --test`.
 *
 * Variants (dev settings → Double take → Text):
 *  - wave (default): word by word, ~28 ms apart, each dropping ~5 px into
 *    place from a strong blur (Apple's demo, per word);
 *  - soft: word by word, slower (~42 ms apart), each rising ~7 px from below
 *    (closer to Siri's card);
 *  - lines: a line at a time, as in Apple's first demo.
 */

export const REVEAL_VARIANTS = ['wave', 'soft', 'lines'] as const;
export type RevealVariant = (typeof REVEAL_VARIANTS)[number];

export interface RevealStyle {
  /** Delay between one unit (word, or line) and the next, ms, while the text is short. */
  stagger: number;
  /**
   * The most time the starts may spread over, ms: a long text staggers faster,
   * so the whole reveal stays about as long as Apple's (~0.9 s), however many words.
   */
  spread: number;
  /** How long one unit takes to settle, ms (the spring is ~98% there by then). */
  settle: number;
  /** Where the unit starts, px off its place: negative above it (it drops in), positive below (it rises). */
  offset: number;
  /** Starting scale. */
  scale: number;
  /** Starting blur, px (browsers; native views can't blur, see `revealFrame`). */
  blur: number;
  /** Words, or lines. */
  unit: 'word' | 'line';
}

export const REVEAL_STYLES: Record<RevealVariant, RevealStyle> = {
  wave: { stagger: 28, spread: 520, settle: 420, offset: -5, scale: 0.98, blur: 8, unit: 'word' },
  soft: { stagger: 42, spread: 760, settle: 560, offset: 7, scale: 0.96, blur: 9, unit: 'word' },
  lines: { stagger: 110, spread: 560, settle: 460, offset: -6, scale: 1, blur: 14, unit: 'line' },
};

/** Extra pause before the hint line, after the last word has started. */
export const REVEAL_HINT_GAP = 40;

/** Time between consecutive starts for `n` units: the variant's stagger, or less for a long text. */
export function unitStep(n: number, variant: RevealVariant = 'wave'): number {
  const { stagger, spread } = REVEAL_STYLES[variant];
  return n > 1 ? Math.min(stagger, spread / (n - 1)) : stagger;
}

/** When each of `n` units starts, ms. */
export function unitDelays(n: number, variant: RevealVariant = 'wave'): number[] {
  const step = unitStep(n, variant);
  return Array.from({ length: Math.max(0, n) }, (_, i) => i * step);
}

/** When the hint (after `n` units) starts, and when everything has settled. */
export function revealSchedule(n: number, variant: RevealVariant = 'wave'): { hint: number; total: number } {
  const s = REVEAL_STYLES[variant];
  const hint = Math.max(0, n - 1) * unitStep(n, variant) + REVEAL_HINT_GAP;
  return { hint, total: hint + s.settle };
}

/**
 * A critically damped spring's progress (no overshoot), 0..1, `t` ms after
 * it started, tuned to be ~98% there at `settle` ms.
 */
export function springProgress(t: number, settle: number): number {
  'worklet';
  if (t <= 0) return 0;
  const w = 5.8 / Math.max(1, settle);
  const x = w * t;
  return Math.min(1, 1 - (1 + x) * Math.exp(-x));
}

export interface RevealFrame {
  opacity: number;
  translateY: number;
  scale: number;
  /** Blur in px (browsers only). */
  blur: number;
}

/**
 * One unit's look `ms` into the reveal. With a real blur (browsers), it fades
 * in quickly, as Apple's does, and the blur does the softening. Without one
 * (iOS and Android views, where a per-word blur isn't cheap), the fade trails
 * the motion instead, which reads as the same "resolving" out of a haze.
 */
export function revealFrame(ms: number, delay: number, s: RevealStyle, blurs = false): RevealFrame {
  'worklet';
  const p = springProgress(ms - delay, s.settle);
  return {
    opacity: blurs ? Math.min(1, p * 2.2) : p * p * (3 - 2 * p),
    translateY: (1 - p) * s.offset,
    scale: s.scale + (1 - s.scale) * p,
    blur: (1 - p) * s.blur,
  };
}

/** The words of a text, for word units (whitespace collapsed). */
export function revealWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// ---- the line-at-a-time timing used before, kept for callers of the old API ----

/** Delay between one line and the next, ms. */
export const REVEAL_LINE_MS = 45;
/** How long one line takes to resolve, ms. */
export const REVEAL_LINE_DURATION = 240;

/** When each of `n` lines starts. */
export function lineDelays(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i * REVEAL_LINE_MS);
}

/** When the hint (after `n` text lines) starts, and when everything has resolved. */
export function revealTimes(n: number): { hint: number; total: number } {
  const hint = Math.max(0, n) * REVEAL_LINE_MS + REVEAL_HINT_GAP;
  return { hint, total: hint + REVEAL_LINE_DURATION };
}

/** One line's progress (0..1, eased out) `ms` into the reveal. */
export function lineProgress(ms: number, delay: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (ms - delay) / REVEAL_LINE_DURATION));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/** A soft wipe's leading edge (percent of the block's height), `ms` into a reveal of `total` ms. */
export function wipeEdge(ms: number, total: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, ms / Math.max(1, total)));
  return -25 + 150 * t;
}
