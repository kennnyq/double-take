/**
 * The walkthrough section's choreography: what the phone shows at each point
 * of the section's scroll. Pure, so it runs under `node --test`.
 *
 *   0 ── swipe to the next clip ── double tap ── spotlight eases in ──
 *   step 1 … step n (scroll = next step: the spotlight and card move to the
 *   next tell, the text rises line by line, the card comes out of the screen
 *   and goes back) ── spotlight eases out ── 1
 */
import { clamp01, easeInOut, easeOut, plateau, seg, stepsAt } from './timeline.ts';

export interface WalkFrame {
  /** The feed swiping from the first clip to the one with tells, 0..1. */
  swipe: number;
  /** The double tap's two rings, 0..1 each (0 before, 1 gone). */
  tap: [number, number];
  /** The double take opening (spotlight, card in), 0..1, then closing back to 0. */
  open: number;
  /** Where along the steps it is, continuous: k when settled on step k, between while moving. */
  at: number;
  /** Which step is current, and how far through its span. */
  index: number;
  s: number;
  /** Each step's text, 0..1 of its reveal (rising in, or reversing out). */
  text: number[];
  /** How far the current card is out of the screen, 0..1. */
  lift: number;
  /** The video: play the feed (-1) or loop step k. */
  video: number;
}

/** Where the steps run, of the section's progress. */
export const STEPS_FROM = 0.25;
export const STEPS_TO = 0.93;

/** Within a step's span: moving over from the last one, the text rising, the card out and back. */
const ARRIVE = 0.16;
const TEXT_FROM = 0.06;
const TEXT_TO = 0.5;
const EXIT = 0.08;

export function walkFrame(p: number, n: number): WalkFrame {
  const swipe = easeInOut(seg(p, 0.03, 0.13));
  const tap: [number, number] = [seg(p, 0.14, 0.2), seg(p, 0.165, 0.225)];
  const opening = easeInOut(seg(p, 0.19, 0.26));
  const closing = easeInOut(seg(p, 0.94, 0.99));
  const open = opening * (1 - closing);
  const { index, s } = stepsAt(p, n, STEPS_FROM, STEPS_TO);
  const arrive = index > 0 ? easeInOut(seg(s, 0, ARRIVE)) : 1;
  const at = index > 0 ? index - 1 + arrive : 0;
  const text = Array.from({ length: n }, (_, j) => {
    if (j === index) return seg(s, j === 0 ? 0 : TEXT_FROM, TEXT_TO) * (j === 0 ? opening : 1) * (1 - closing);
    if (j === index - 1) return 1 - seg(s, 0, EXIT);
    return 0;
  });
  const lift = plateau(s, 0.44, 0.6, 0.84, 0.97) * (p < STEPS_TO ? 1 : 0);
  const video = p >= 0.2 && p < 0.955 ? index : -1;
  return { swipe, tap, open, at, index, s, text, lift, video };
}

/** A step dot's look: how reached (0..1) and how current (0..1), from the continuous step position. */
export function dotLook(at: number, i: number): { reached: number; current: number } {
  return { reached: clamp01(at - i + 1), current: 1 - Math.min(1, Math.abs(at - i)) };
}

/** The forward arrow turning into a check on the last step, 0..1. */
export function checkLook(at: number, n: number): number {
  return n <= 1 ? 1 : easeOut(clamp01(at - (n - 2)));
}
