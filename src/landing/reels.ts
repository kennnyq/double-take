/**
 * Tiles that "scroll to the next reel": now and then one tile's clip slides up
 * and out while the next slides in from below, inside the tile, then plays on.
 * Pure logic (no DOM): the snap's easing, how a swipe cuts two atlas cells into
 * one tile, and which tile goes next and to which clip. `AtlasPlayer.ts` draws it.
 */

/** How often tiles swipe: a design on trial (`reels` in designs.ts). */
export interface ReelPace {
  /** Seconds between one swipe and the next, somewhere on screen (randomised ±40%). */
  gap: number;
  /** A tile swipes at most this often, s. */
  each: number;
}

export const REEL_PACES = {
  often: { gap: 1.2, each: 8 },
  sometimes: { gap: 2.2, each: 14 },
  rarely: { gap: 4, each: 22 },
} satisfies Record<string, ReelPace>;

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

/** A tile that could swipe: where it is on screen, its size, its clip, and when it last swiped (ms). */
export interface ReelTile {
  key: string;
  x: number;
  y: number;
  size: number;
  cell: number;
  last: number;
}

/**
 * The next swipe: the on-screen tile that has waited longest (past `each`),
 * give or take a little chance, and a clip for it that no tile near it shows,
 * preferring the clips least on screen. Null when no tile is due.
 */
export function pickSwipe(
  tiles: readonly ReelTile[],
  cells: number,
  now: number,
  pace: ReelPace,
  random: () => number = Math.random,
): { key: string; cell: number } | null {
  const due = tiles.filter((t) => now - t.last >= pace.each * 1000);
  if (!due.length || cells < 2) return null;
  let tile = due[0];
  let best = -Infinity;
  for (const t of due) {
    const score = now - t.last + random() * pace.each * 500;
    if (score > best) {
      best = score;
      tile = t;
    }
  }
  const near = new Set(
    tiles.filter((o) => o.key !== tile.key && Math.hypot(o.x - tile.x, o.y - tile.y) < tile.size * 3).map((o) => o.cell),
  );
  const shown = new Map<number, number>();
  for (const t of tiles) shown.set(t.cell, (shown.get(t.cell) ?? 0) + 1);
  const all = Array.from({ length: cells }, (_, c) => c).filter((c) => c !== tile.cell);
  const fresh = all.filter((c) => !near.has(c));
  const pool = fresh.length ? fresh : all;
  const fewest = Math.min(...pool.map((c) => shown.get(c) ?? 0));
  const least = pool.filter((c) => (shown.get(c) ?? 0) === fewest);
  return { key: tile.key, cell: least[Math.floor(random() * least.length)] };
}

/** Seconds until the next swipe somewhere: `gap`, ±40%. */
export function nextGap(pace: ReelPace, random: () => number = Math.random): number {
  return pace.gap * (0.6 + random() * 0.8);
}
