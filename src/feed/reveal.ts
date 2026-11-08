/**
 * Timing for the info card's text reveal, modelled on how Siri's answers
 * appear (studied frame by frame from Kenny's screen recording): a wipe from
 * the top, about one line every two or three frames, sweeping a little left
 * to right, each line going from faint and blurred to sharp in about a
 * quarter of a second while the block drifts up a few points. Pure, so it
 * runs under `node --test`.
 */

/** Delay between one line and the next, ms. */
export const REVEAL_LINE_MS = 45;
/** How long one line takes to resolve, ms. */
export const REVEAL_LINE_DURATION = 240;
/** Extra pause before the hint line. */
export const REVEAL_HINT_GAP = 40;

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

/**
 * Browsers draw the text as one block and wipe it in with a soft gradient
 * mask: where the wipe's leading edge is, as a percentage of the block's
 * height, `ms` into a reveal of `total` ms. It starts above the block and ends
 * past it, so every line gets the same soft edge.
 */
export function wipeEdge(ms: number, total: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, ms / Math.max(1, total)));
  return -25 + 150 * t;
}
