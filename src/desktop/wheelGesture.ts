/**
 * Turns a raw stream of wheel events into discrete "go to next/previous item"
 * intents, the way short-video feeds behave on desktop:
 *
 * - One trackpad flick moves exactly one item, even though macOS keeps emitting
 *   momentum events for ~1s afterwards.
 * - A second flick made while the first one's momentum is still decaying is
 *   recognised (rising deltas after a trough) and moves one more item.
 * - Notched mouse wheels move one item per tick burst; spinning steadily keeps
 *   advancing at a controlled rate instead of skipping many items.
 * - Reversing direction starts a new gesture immediately.
 *
 * The detector is pure (no DOM, no timers), so it can be unit-tested with
 * synthetic event sequences.
 */

export type Direction = -1 | 0 | 1;

export interface WheelGestureOptions {
  /** Accumulated |deltaY| (px) required before the first move of a gesture. */
  threshold: number;
  /** Silence (ms) after which the next event starts a brand-new gesture. */
  idleMs: number;
  /** Minimum time (ms) between two moves inside one continuous event stream. */
  minRefireMs: number;
  /** Minimum |delta| for a rising edge to count as a fresh flick. */
  refireMinDelta: number;
  /** Rising delta must exceed trough * ratio (+ refireMinDelta / 2). */
  refireRatio: number;
  /** Constant-size deltas at least this big are treated as notched-wheel ticks. */
  notchMinDelta: number;
  /** Minimum time (ms) between moves for continuous notched-wheel spinning. */
  notchRepeatMs: number;
}

export const DEFAULT_WHEEL_OPTIONS: WheelGestureOptions = {
  threshold: 24,
  idleMs: 140,
  minRefireMs: 180,
  refireMinDelta: 14,
  refireRatio: 2,
  notchMinDelta: 40,
  notchRepeatMs: 320,
};

export class WheelGestureDetector {
  private opts: WheelGestureOptions;
  private inGesture = false;
  private fired = false;
  private dir: Direction = 0;
  private accum = 0;
  private lastT = -Infinity;
  private lastAbs = 0;
  private trough = Infinity;
  private rising = 0;
  private same = 0;
  private fireT = -Infinity;

  constructor(opts: Partial<WheelGestureOptions> = {}) {
    this.opts = { ...DEFAULT_WHEEL_OPTIONS, ...opts };
  }

  reset(): void {
    this.inGesture = false;
    this.fired = false;
    this.dir = 0;
    this.accum = 0;
    this.lastAbs = 0;
    this.trough = Infinity;
    this.rising = 0;
    this.same = 0;
  }

  /**
   * Feed one normalized vertical delta (px, positive = scroll down / next) and
   * its timestamp (ms). Returns the direction to move, or 0 for no move.
   */
  push(deltaY: number, t: number): Direction {
    const o = this.opts;
    const abs = Math.abs(deltaY);
    if (abs === 0) return 0;
    const sign: Direction = deltaY > 0 ? 1 : -1;

    if (t - this.lastT > o.idleMs) this.reset();
    this.lastT = t;

    // Opposite direction with real intent: a new gesture, even mid-momentum.
    if (this.inGesture && sign !== this.dir && abs >= 4) this.reset();

    if (!this.inGesture) {
      this.inGesture = true;
      this.dir = sign;
      this.accum = 0;
    }

    if (sign !== this.dir) {
      // Tiny jitter against the gesture direction; ignore.
      return 0;
    }

    if (!this.fired) {
      this.accum += abs;
      this.lastAbs = abs;
      if (this.accum >= o.threshold) return this.fire(abs, t);
      return 0;
    }

    // Already moved for this stream: we are in momentum or a continued drag.
    const sinceFire = t - this.fireT;

    // Notched wheel spun continuously: a run of identical, large deltas.
    // (Trackpad momentum decays every frame, so it never forms such a run.)
    this.same = abs === this.lastAbs ? this.same + 1 : 0;
    if (abs >= o.notchMinDelta && this.same >= 2 && sinceFire >= o.notchRepeatMs) {
      return this.fire(abs, t);
    }

    if (abs > this.lastAbs) this.rising += 1;
    else this.rising = 0;
    this.trough = Math.min(this.trough, abs);

    const freshFlick =
      this.rising >= 2 &&
      abs >= o.refireMinDelta &&
      abs >= this.trough * o.refireRatio + o.refireMinDelta / 2 &&
      sinceFire >= o.minRefireMs;

    this.lastAbs = abs;
    if (freshFlick) return this.fire(abs, t);
    return 0;
  }

  private fire(abs: number, t: number): Direction {
    this.fired = true;
    this.fireT = t;
    this.lastAbs = abs;
    this.trough = abs;
    this.rising = 0;
    this.same = 0;
    return this.dir;
  }
}

/** Converts a WheelEvent's delta into pixels regardless of deltaMode. */
export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageHeight: number,
): number {
  if (deltaMode === 1) return delta * 16; // lines (Firefox mouse wheels)
  if (deltaMode === 2) return delta * pageHeight; // pages
  return delta;
}
