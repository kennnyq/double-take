import type { LandingValues } from './designs';

/**
 * How the gallery stops when the launch starts: how long it takes, and its
 * speed (as a playback rate, 1 to 0) along the way. `coast` takes much longer
 * and leaves a long, soft tail, so the strips are still drifting while the
 * tiles leave; it outlasts the exits (`pace`) by over a second.
 */
export function slowdown(motion: LandingValues['motion'], pace: number): { ms: number; rate(t: number): number } | null {
  if (motion === 'decelerate') return { ms: 650, rate: (t) => (1 - t) ** 2 };
  if (motion === 'coast') return { ms: pace + 1400, rate: (t) => (1 - t) ** 2 };
  return null;
}
