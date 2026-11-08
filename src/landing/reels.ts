import { likeness } from './spread.ts';

/**
 * Tiles that "scroll to the next reel": as a tile's clip comes to its end, it
 * slides up and out while the next clip slides in from below, from its first
 * frame, inside the tile; that one plays to its end, and so on. Pure logic (no
 * DOM): the snap's easing, how a swipe cuts two atlas cells into one tile, and
 * when and to which clip a tile hands over. `AtlasPlayer.ts` draws it.
 *
 * Every cell loops on the atlas's one timeline, each from its own moment (its
 * phase), so a tile can only take a clip at the instant that clip starts. Near
 * the end of its clip, a tile looks at the clips starting before its own must
 * stop, and takes the best of them right as it starts: no stall, no skip.
 */

/** How a tile turns to its next clip: a reel's swipe, or (lighter on phones) a soft crossfade. */
export type Turn = 'slide' | 'fade';

/** How long a crossfade takes, ms. */
export const FADE_MS = 560;

/** smoothstep: eases in and out, for the crossfade. */
export function soft(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** How long a swipe takes, ms: a reel's snap. */
export const SWIPE_MS = 420;

/**
 * cubic-bezier(0.25, 0.8, 0.25, 1): leaves quickly, the way a released swipe
 * does, and settles softly into place. Continuous throughout; it starts from
 * a standstill only in the first instant.
 */
export function snap(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = [0.25, 0.8, 0.25, 1];
  const bez = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

export interface Slice {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * A tile part way (`p`, 0..1) through a swipe: the bottom of the old clip at
 * the top, the top of the new one below it, meeting where the old one's edge
 * has slid to. Cut from the cells (no clipping), so nothing spills out of the
 * tile. `from` and `to` are where each cell's crop starts in the atlas.
 */
export function swipeSlices(
  p: number,
  d: { sw: number; sh: number; dx: number; dy: number; dw: number; dh: number },
  from: { sx: number; sy: number },
  to: { sx: number; sy: number },
): Slice[] {
  const out: Slice[] = [];
  const keep = 1 - p;
  if (keep > 0) out.push({ sx: from.sx, sy: from.sy + p * d.sh, sw: d.sw, sh: keep * d.sh, dx: d.dx, dy: d.dy, dw: d.dw, dh: keep * d.dh });
  if (p > 0) out.push({ sx: to.sx, sy: to.sy, sw: d.sw, sh: p * d.sh, dx: d.dx, dy: d.dy + keep * d.dh, dw: d.dw, dh: p * d.dh });
  return out;
}

/** Where a cell is in its loop at atlas time `t` (s), given its phase. */
export function loopAt(t: number, phase: number, loop: number): number {
  return (((t + phase) % loop) + loop) % loop;
}

/** When, at or after atlas time `t`, a cell's loop next starts. */
export function nextStart(t: number, phase: number, loop: number): number {
  const at = loopAt(t, phase, loop);
  return at === 0 ? t : t + (loop - at);
}

/**
 * The stretch of a clip's loop (s into it) in which it may hand over. It must
 * be gone before its loop's closing dissolve (`lead`) begins, so the last
 * moment a swipe can start is a swipe's length before that; it looks `window`
 * seconds ahead of that for a clip to take.
 */
export function handover(loop: number, lead: number, window = 2, ms = SWIPE_MS): { from: number; until: number } {
  const until = loop - lead - ms / 1000;
  return { from: Math.max(0, until - window), until };
}

/** Tiles near the one handing over: where they are, and the clip each shows (or is about to). */
export interface Neighbour {
  x: number;
  y: number;
  cell: number;
}

/** Swipes this close together (s) read as one; spread them apart if there's a choice. */
export const CLASH = 0.15;
/**
 * How many atlas frames a swipe may start after its clip's first one: a
 * nudge of up to ~130 ms (at 15 fps), so swipes due at the same instant can
 * spread out. Each clip only starts once per loop, so without it, tiles
 * taking clips that start together would all swipe at once.
 */
export const NUDGE_FRAMES = 2;

/** A clip isn't put within this many tile-widths of itself, its duplicate or a close look-alike. */
const KEEP_OFF = 2;
/** How alike counts as close here (likeness: the same clip 1, a duplicate 0.9, a close look-alike ~0.3+). */
const CLOSE = 0.3;

/** How much a tile at `at`, `size` px across, showing `cell` would look like its neighbours: nearer counting more. */
export function lookAround(
  at: { x: number; y: number; size: number },
  cell: number,
  neighbours: readonly Neighbour[],
  distances?: readonly (readonly number[])[],
): number {
  let sum = 0;
  for (const o of neighbours) {
    const away = Math.max(Math.hypot(o.x - at.x, o.y - at.y) / at.size, 0.5);
    sum += likeness(cell, o.cell, distances) / (away * away);
  }
  return sum;
}

/**
 * How busy the wall is (a design on trial: `busy`). Turns still only happen as
 * a clip ends, but a tile keeps a clip at least `hold` seconds (looping it
 * meanwhile), at most `perSecond` turns start in any second on screen, and
 * none within `apart` tile-widths of another within `within` seconds. A tile
 * that can't turn at one end loops once more and tries at the next.
 */
export interface Busyness {
  hold: number;
  perSecond: number;
  apart: number;
  within: number;
}

export const BUSYNESS = {
  calm: { hold: 13, perSecond: 3, apart: 2.5, within: 1 },
  medium: { hold: 8, perSecond: 5, apart: 2, within: 0.75 },
  lively: { hold: 0, perSecond: 12, apart: 1.5, within: 0.5 },
} satisfies Record<string, Busyness>;

/** A turn planned (or under way): when (atlas time), and where on screen. */
export interface Planned {
  at: number;
  x: number;
  y: number;
  size: number;
}

/** Whether a turn at `at`, at (x, y), fits the plan: under the cap for its second, and apart from the turns near it in time. O(plan). */
export function fits(plan: readonly Planned[], at: number, x: number, y: number, size: number, b: Busyness): boolean {
  let sameSecond = 0;
  for (const p of plan) {
    const dt = Math.abs(p.at - at);
    if (dt < 0.5) sameSecond++;
    if (dt < b.within && Math.hypot(p.x - x, p.y - y) < b.apart * Math.max(size, p.size)) return false;
  }
  return sameSecond < b.perSecond;
}

/**
 * The clip a tile hands over to, and when (atlas time): one starting between
 * now (`t`) and `until`, that isn't its own, that looks least like the tiles
 * around it and isn't near a look-alike, preferably from `prefer` (a strip's
 * own set), not starting with (and preferably not within CLASH of) another
 * swipe (`busy`): nudged by a frame or two if that spreads them out; then the
 * latest of equals, so the outgoing clip plays as long as it can.
 */
export function chooseNext({
  tile,
  t,
  until,
  phases,
  loop,
  neighbours,
  distances,
  prefer,
  busy = [],
  fps = 15,
  fitsAt,
}: {
  tile: { x: number; y: number; size: number; cell: number };
  t: number;
  until: number;
  phases: readonly number[];
  loop: number;
  neighbours: readonly Neighbour[];
  distances?: readonly (readonly number[])[];
  prefer?: readonly number[];
  busy?: readonly number[];
  fps?: number;
  /** Whether a turn may start then (the busyness plan, see `fits`). */
  fitsAt?: (at: number) => boolean;
}): { cell: number; at: number } | null {
  let best: { cell: number; at: number } | null = null;
  let bestScore = Infinity;
  phases.forEach((phase, cell) => {
    if (cell === tile.cell) return;
    const at = nextStart(t, phase, loop);
    if (at > until) return;
    const beside = neighbours.some(
      (o) => Math.hypot(o.x - tile.x, o.y - tile.y) < KEEP_OFF * tile.size && likeness(cell, o.cell, distances) >= CLOSE,
    );
    if (beside) return;
    const look = lookAround(tile, cell, neighbours, distances);
    const off = prefer && !prefer.includes(cell) ? 0.05 : 0;
    for (let k = 0; k <= NUDGE_FRAMES; k++) {
      const when = at + k / fps;
      if (when > until) break;
      if (fitsAt && !fitsAt(when)) continue;
      const together = busy.some((b) => Math.abs(b - when) < 0.5 / fps) ? 10 : 0;
      const near = busy.filter((b) => Math.abs(b - when) < CLASH).length * 0.5;
      const score = look + off + together + near + k * 0.02 - (at - t) * 1e-3;
      if (score < bestScore) {
        bestScore = score;
        best = { cell, at: when };
      }
    }
  });
  return best;
}
