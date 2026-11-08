/**
 * The progress bar's arithmetic. Pure, so it runs under `node --test`.
 */

/** Where along the bar a point is, 0..1. */
export function fracAt(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, x / width));
}

/** "m:ss" (or "h:mm:ss"). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The time bubble's text while scrubbing: "0:07 / 0:15". */
export function timeLabel(t: number, duration: number): string {
  return `${formatTime(t)} / ${formatTime(duration)}`;
}

/** Arrow keys: how far one press moves, seconds. */
export const ARROW_SEEK = 5;

/** Where an arrow key goes: `delta` seconds on, inside the clip (stopping short of its very end, which would loop). */
export function seekBy(current: number, delta: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(Math.max(0, duration - 0.25), Math.max(0, current + delta));
}

/** Movement (px) before a press on the bar counts as a drag rather than a tap. */
export const DRAG_SLOP = 6;

/**
 * What a press on the bar is turning into, from how far it has moved: a
 * horizontal drag scrubs; a vertical one belongs to the feed (swipe to the
 * next clip); too little either way is still a tap.
 */
export function pressIntent(dx: number, dy: number, slop = DRAG_SLOP): 'tap' | 'drag' | 'swipe' {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop * 1.5) return 'tap';
  return ax >= ay ? 'drag' : 'swipe';
}
