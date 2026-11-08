/**
 * Timing for the info card's text reveal, modelled on how Siri's answers
 * appear (studied frame by frame from Kenny's screen recording): a wipe from
 * the top, about one line every two frames, sweeping a little left to right
 * within each line, every word going from faint and blurred to sharp in about
 * a quarter of a second. Pure, so it runs under `node --test`.
 */

/** Delay between one line and the next, ms. */
export const REVEAL_LINE_MS = 40;
/** Delay between words within a line, ms. */
export const REVEAL_WORD_STAGGER_MS = 9;
/** How long one word takes to resolve, ms. */
export const REVEAL_WORD_MS = 220;

/**
 * Each word's delay from the words' laid-out tops (px, in reading order):
 * words sharing a top share a line; lines go top to bottom.
 */
export function revealDelays(tops: number[]): number[] {
  const lines = [...new Set(tops.map((t) => Math.round(t)))].sort((a, b) => a - b);
  const seen = new Map<number, number>();
  return tops.map((t) => {
    const y = Math.round(t);
    const line = lines.indexOf(y);
    const k = seen.get(y) ?? 0;
    seen.set(y, k + 1);
    return line * REVEAL_LINE_MS + k * REVEAL_WORD_STAGGER_MS;
  });
}
