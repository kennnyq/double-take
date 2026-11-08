/**
 * The features section's scroll timeline. Pure, so it runs under `node --test`.
 *
 * The section is one tall track with a pinned stage. Scrolling through the
 * track moves a position (in screens: one screen is one viewport height of
 * scroll) along the sections laid end to end; each section reads its own
 * progress, 0 at its start and 1 at its end, and turns that into motion.
 * Everything is a function of the position, so the page can be scrubbed
 * both ways and stopped anywhere.
 */

export const SECTION_IDS = ['scroll', 'upload', 'game', 'skills', 'account'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Each section's length, in screens of scroll, at the medium length. */
export const SECTION_SCREENS: Record<SectionId, number> = {
  scroll: 6.5,
  upload: 3.4,
  game: 3.4,
  skills: 2.6,
  account: 2.8,
};

export const LENGTH_SCALE = { short: 0.65, medium: 1, long: 1.4 } as const;

export interface Placed {
  id: SectionId;
  /** Where it starts and ends along the track, screens. */
  start: number;
  end: number;
}

export interface TrackLayout {
  sections: Placed[];
  /** Screens of scroll through every section. */
  total: number;
}

/** The sections shown, end to end, `scale` times their medium length. */
export function layoutSections(ids: readonly SectionId[], scale = 1): TrackLayout {
  let at = 0;
  const sections = ids.map((id) => {
    const start = at;
    at += SECTION_SCREENS[id] * scale;
    return { id, start, end: at };
  });
  return { sections, total: at };
}

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** How far `p` is through [a, b], 0..1. */
export function seg(p: number, a: number, b: number): number {
  return b === a ? (p >= b ? 1 : 0) : clamp01((p - a) / (b - a));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sine ease in and out, 0..1. */
export function easeInOut(t: number): number {
  return (1 - Math.cos(Math.PI * clamp01(t))) / 2;
}

/** Cubic ease out, 0..1. */
export function easeOut(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** Cubic ease in, 0..1. */
export function easeIn(t: number): number {
  const u = clamp01(t);
  return u * u * u;
}

/** A soft bump: 0 at the ends of [a, d], 1 across [b, c], eased in between. */
export function plateau(p: number, a: number, b: number, c: number, d: number): number {
  return easeInOut(seg(p, a, b)) * (1 - easeInOut(seg(p, c, d)));
}

/** A section's own progress at track position `pos` (screens): unclamped, so motion can run a little past either end. */
export function localProgress(s: Placed, pos: number): number {
  return (pos - s.start) / (s.end - s.start);
}

/**
 * How much a section is the one on screen: 1 inside it, easing to 0 over
 * `fade` screens past either end. Neighbours cross over at their shared edge.
 * The first section is fully there before the track (the stage scrolls in
 * with it); the last stays after the track.
 */
export function presence(s: Placed, pos: number, fade: number, first: boolean, last: boolean): number {
  const into = first ? 1 : seg(pos, s.start - fade / 2, s.start + fade / 2);
  const out = last ? 1 : 1 - seg(pos, s.end - fade / 2, s.end + fade / 2);
  return easeInOut(Math.min(into, out));
}

/** The section the position is in, and how far through it (for the index). */
export function current(layout: TrackLayout, pos: number): { index: number; p: number } {
  const { sections } = layout;
  for (let i = 0; i < sections.length; i++) {
    if (pos < sections[i].end || i === sections.length - 1) return { index: i, p: clamp01(localProgress(sections[i], pos)) };
  }
  return { index: 0, p: 0 };
}

/**
 * One step of an exponential follower: where `value` is `dtMs` later on its
 * way to `target` with time constant `tauMs` (0: right there). It always
 * moves from where it is, so a new target simply retargets it.
 */
export function follow(value: number, target: number, dtMs: number, tauMs: number, epsilon = 1e-4): number {
  if (tauMs <= 0 || Math.abs(target - value) < epsilon) return target;
  return value + (target - value) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
}

/** The follower's time constant for each knob setting, ms. */
export const FOLLOW_TAU = { direct: 0, smooth: 90, floaty: 220 } as const;

/**
 * `n` steps spread over [a, b] of `p`: which step it's in (clamped to the
 * steps) and how far through it (0..1; 0 before the first, 1 after the last).
 */
export function stepsAt(p: number, n: number, a: number, b: number): { index: number; s: number } {
  if (n <= 0) return { index: 0, s: 0 };
  const x = ((p - a) / (b - a)) * n;
  if (x <= 0) return { index: 0, s: 0 };
  if (x >= n) return { index: n - 1, s: 1 };
  const index = Math.floor(x);
  return { index, s: x - index };
}

/**
 * A two-digit counter's wheels at a continuous value (an odometer): where the
 * ones wheel is (0..10, 10 being the 0 after 9) and the tens wheel, which
 * turns only while the ones wheel rolls from 9 to 0.
 */
export function wheels(value: number): { tens: number; ones: number } {
  const v = Math.max(0, value);
  const ones = v - 10 * Math.floor(v / 10);
  return { tens: Math.floor(v / 10) + Math.max(0, ones - 9), ones };
}
