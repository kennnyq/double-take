/**
 * Keeping look-alike clips apart. With 24 clips over a wall of tiles, clips
 * repeat; this places the same clip, and clips that look alike (the atlas's
 * `distances`), as far apart as it can, both for the first layout and for each
 * reel swipe's next clip. Pure logic; `AtlasPlayer.ts` applies it.
 */

/** Below this distance two clips are the same footage (one clip under two ids). */
export const DUPLICATE = 0.04;
/** Below this, they look alike (palette and layout). */
export const SIMILAR = 0.1;

/** How much two clips look alike, 0..1: 1 for the same clip, about 0.9 for a duplicate, fading to 0 by twice SIMILAR. */
export function likeness(a: number, b: number, distances?: readonly (readonly number[])[]): number {
  if (a === b) return 1;
  const d = distances?.[a]?.[b];
  if (d === undefined) return 0;
  if (d < DUPLICATE) return 0.9;
  return Math.max(0, 0.6 * (1 - d / (2 * SIMILAR)));
}

/** A spot for a clip: where it is (any consistent px), and its size. */
export interface Spot {
  key: string;
  x: number;
  y: number;
  size: number;
}

/** How strongly two spots `dist` px apart count against each other, for tiles of `size`: falls off with the square of tile-widths. */
function closeness(dist: number, size: number) {
  const tiles = Math.max(dist / size, 0.5);
  return 1 / (tiles * tiles);
}

/** Spots within this many tile-widths count as neighbours. */
const REACH = 6;

/**
 * A clip for every spot: the centre of `around` first, each spot taking the
 * clip that looks least like what its neighbours have, and using each clip
 * about equally; then a few passes in which every spot takes another look
 * with all its neighbours placed, which a first, greedy pass can't see.
 */
export function spreadCells(
  spots: readonly Spot[],
  cells: number,
  distances: readonly (readonly number[])[] | undefined,
  around: { x: number; y: number },
  random: () => number = Math.random,
  passes = 3,
): Map<string, number> {
  const order = [...spots].sort((a, b) => Math.hypot(a.x - around.x, a.y - around.y) - Math.hypot(b.x - around.x, b.y - around.y));
  // Each spot's neighbours and how much they count, once.
  const near = order.map((spot) =>
    order.flatMap((other, j) => {
      if (other === spot) return [];
      const w = closeness(Math.hypot(spot.x - other.x, spot.y - other.y), spot.size);
      return w >= 1 / (REACH * REACH) ? [{ j, w }] : [];
    }),
  );
  const like = Array.from({ length: cells }, (_, a) => Array.from({ length: cells }, (_, b) => likeness(a, b, distances)));
  const cellOf = new Array<number>(order.length).fill(-1);
  const used = new Array<number>(cells).fill(0);
  /** The best clip for spot `i`, with `placed` spots placed (each clip's fair share is placed / cells). */
  const choose = (i: number, placed: number) => {
    const fair = placed / cells;
    let best = -1;
    let bestCost = Infinity;
    for (let c = 0; c < cells; c++) {
      let cost = 0;
      for (const { j, w } of near[i]) if (cellOf[j] >= 0) cost += w * like[c][cellOf[j]];
      // Even use, then a little chance among equals.
      cost += 0.15 * Math.max(0, used[c] + 1 - fair) + random() * 1e-6;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best;
  };
  order.forEach((_, i) => {
    cellOf[i] = choose(i, i + 1);
    used[cellOf[i]]++;
  });
  for (let pass = 0; pass < passes; pass++) {
    order.forEach((_, i) => {
      used[cellOf[i]]--;
      cellOf[i] = -1;
      cellOf[i] = choose(i, order.length);
      used[cellOf[i]]++;
    });
  }
  return new Map(order.map((spot, i) => [spot.key, cellOf[i]]));
}

/** How many sets `stripLoops` splits `cells` clips into: three when each still fills a strip's run, so strips up to two apart never share a clip. */
export function stripSetCount(cells: number): number {
  return cells >= 36 ? 3 : 2;
}

/**
 * Clips for strips that slide past each other (rows, columns). Strips slide
 * at different speeds, so any clip two of them share will, at some point,
 * line up one above the other; and a strip shows its clips in a loop. So the
 * clips are split into `sets` sets (three: strips take them in turn, so no
 * two strips within two of each other share one), the same footage under two
 * ids goes in one set (it then sits half a loop apart), look-alikes are
 * shared out between the sets, and within each loop alikes sit as far apart
 * as they can. Returns the loops.
 */
export function stripLoops(cells: number, distances?: readonly (readonly number[])[], sets = stripSetCount(cells)): number[][] {
  const size = Math.ceil(cells / sets);
  const ks = [...Array(sets).keys()];
  const like = (a: number, b: number) => likeness(a, b, distances);
  const setOf = new Array<number>(cells).fill(-1);
  const count = new Array<number>(sets).fill(0);
  const put = (c: number, k: number) => {
    setOf[c] = k;
    count[k]++;
  };
  // The same footage first, together.
  for (let a = 0; a < cells; a++)
    for (let b = a + 1; b < cells; b++) {
      if (like(a, b) < 0.9 || setOf[a] >= 0 || setOf[b] >= 0) continue;
      const k = ks.reduce((m, x) => (count[x] < count[m] ? x : m), 0);
      if (count[k] + 2 > size) continue;
      put(a, k);
      put(b, k);
    }
  // Then each clip, most look-alikes first, into the set where it has fewer.
  const crowd = (c: number, k: number) => [...Array(cells).keys()].reduce((n, o) => n + (setOf[o] === k && o !== c ? like(c, o) : 0), 0);
  const total = (c: number) => ks.reduce((n, k) => n + crowd(c, k), 0);
  const rest = [...Array(cells).keys()].filter((c) => setOf[c] < 0).sort((a, b) => total(b) - total(a) || a - b);
  for (const c of rest) {
    const options = ks.filter((k) => count[k] < size);
    put(c, options.sort((x, y) => crowd(c, x) - crowd(c, y) || count[x] - count[y])[0]);
  }
  return ks.map((k) => loopOf([...Array(cells).keys()].filter((c) => setOf[c] === k), distances));
}

/** One set's clips round a loop, each placed as far as it can be from its look-alikes (most alike first). */
function loopOf(set: number[], distances?: readonly (readonly number[])[]): number[] {
  const n = set.length;
  const like = (a: number, b: number) => likeness(a, b, distances);
  const slots = new Array<number>(n).fill(-1);
  const order = [...set].sort((a, b) => set.reduce((s, o) => s + (o !== b ? like(b, o) : 0), 0) - set.reduce((s, o) => s + (o !== a ? like(a, o) : 0), 0) || a - b);
  for (const c of order) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (slots[i] >= 0) continue;
      // Pushed away from each placed clip by how alike they are; ties to the earliest slot.
      let score = 0;
      slots.forEach((o, j) => {
        if (o < 0) return;
        const d = Math.min(Math.abs(i - j), n - Math.abs(i - j));
        score -= like(c, o) / (d * d);
      });
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    slots[best] = c;
  }
  return slots;
}

/**
 * How many of a loop's clips a strip of `places` tiles cycles through: the
 * most that divide `places` evenly, so the pattern meets itself exactly where
 * the strip wraps round (a 20-tile row takes 10 of 12; 11 places take 11).
 */
export function stripPeriod(places: number, loop: number): number {
  if (places <= loop) return places;
  for (let p = loop; p >= Math.ceil(loop / 2); p--) if (places % p === 0) return p;
  return loop;
}

/**
 * The clips along strip number `strip`, which has `places` tiles in a loop:
 * strips take the loops in turn, each taking its own run of its loop,
 * repeated. When no run fits evenly, the places left over take the
 * clips that keep the same footage and look-alikes furthest off round the loop.
 */
export function stripSequence(
  loops: readonly (readonly number[])[],
  strip: number,
  places: number,
  distances?: readonly (readonly number[])[],
): number[] {
  const loop = loops[strip % loops.length];
  const period = stripPeriod(places, loop.length);
  const start = Math.floor(strip / loops.length) * 5;
  // Its own run of the loop, laid round its own ring, so alikes keep apart at
  // its period too (a run cut straight from the loop can bring them together).
  const run = loopOf(
    Array.from({ length: period }, (_, i) => loop[(start + i) % loop.length]),
    distances,
  );
  const whole = places % period === 0 ? places : Math.floor(places / period) * period;
  const seq: number[] = [];
  for (let i = 0; i < whole; i++) seq.push(run[i % period]);
  for (let i = whole; i < places; i++) {
    let best = run[0];
    let bestGap = -1;
    for (const c of run) {
      // How close the nearest copy or look-alike would be, round the strip's loop.
      let gap = Infinity;
      seq.forEach((o, j) => {
        if (likeness(c, o, distances) < 0.3) return;
        const d = Math.abs(i - j);
        gap = Math.min(gap, Math.min(d, places - d));
      });
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    seq.push(best);
  }
  return seq;
}
