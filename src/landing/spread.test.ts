import { test } from 'node:test';
import assert from 'node:assert/strict';
import { likeness, spreadCells, stripLoops, stripSequence, stripSetCount, type Spot } from './spread.ts';

// Six clips: 0 and 1 are one clip under two ids, 2 and 3 look alike, 4 and 5 are unlike anything.
const D = [
  [0, 0.02, 0.3, 0.3, 0.3, 0.3],
  [0.02, 0, 0.3, 0.3, 0.3, 0.3],
  [0.3, 0.3, 0, 0.07, 0.3, 0.3],
  [0.3, 0.3, 0.07, 0, 0.3, 0.3],
  [0.3, 0.3, 0.3, 0.3, 0, 0.3],
  [0.3, 0.3, 0.3, 0.3, 0.3, 0],
];

test('likeness: same clip, then duplicate, then look-alike, then unrelated', () => {
  assert.equal(likeness(2, 2, D), 1);
  assert.equal(likeness(0, 1, D), 0.9);
  const alike = likeness(2, 3, D);
  assert.ok(alike > 0.3 && alike < 0.9);
  assert.equal(likeness(4, 5, D), 0);
  // Without distances only the same clip counts.
  assert.equal(likeness(0, 1), 0);
  assert.equal(likeness(3, 3), 1);
});

/** A grid of spots, `cols` x `rows`, a tile apart. */
const grid = (cols: number, rows: number): Spot[] =>
  Array.from({ length: cols * rows }, (_, i) => ({ key: String(i), x: (i % cols) * 100, y: Math.floor(i / cols) * 100, size: 100 }));

/** The closest two spots get to each other, in tiles, among spots whose clips are `alike`. */
function closest(spots: Spot[], cells: Map<string, number>, alike: (a: number, b: number) => boolean) {
  let min = Infinity;
  for (const a of spots)
    for (const b of spots) {
      if (a === b || !alike(cells.get(a.key)!, cells.get(b.key)!)) continue;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) / 100);
    }
  return min;
}

test('spreadCells: on a tight wall (6 clips, 24 tiles) no clip or duplicate sits beside itself, and use stays even', () => {
  const spots = grid(6, 4);
  const cells = spreadCells(spots, 6, D, { x: 250, y: 150 }, () => 0.5);
  const counts = [0, 0, 0, 0, 0, 0];
  cells.forEach((c) => counts[c]++);
  assert.ok(Math.min(...counts) >= 2 && Math.max(...counts) - Math.min(...counts) <= 2, `uses ${counts}`);
  // At worst diagonal (1.41 tiles), never edge to edge.
  assert.ok(closest(spots, cells, (a, b) => a === b) > 1.4, 'same clip');
  assert.ok(closest(spots, cells, (a, b) => D[a][b] < 0.04) > 1.4, 'duplicates');
});

/** 24 clips like the atlas's: unrelated, but for one duplicate pair and two look-alike pairs. */
function atlasLike(n = 24): number[][] {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const d = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i][j] = d[j][i] = 0.12 + rnd() * 0.22;
  const set = (i: number, j: number, v: number) => (d[i][j] = d[j][i] = v);
  set(0, 9, 0.017);
  set(3, 19, 0.067);
  set(15, 22, 0.095);
  return d;
}

test('spreadCells keeps duplicates and look-alikes far apart across a wall, unlike a plain repeating order', () => {
  const R = atlasLike();
  const spots = grid(8, 6);
  const spread = spreadCells(spots, 24, R, { x: 350, y: 250 }, () => 0.5);
  const plain = new Map(spots.map((s, i) => [s.key, i % 24]));
  const dup = (a: number, b: number) => R[a][b] < 0.04;
  const alike = (a: number, b: number) => R[a][b] < 0.1;
  assert.ok(closest(spots, spread, (a, b) => a === b) >= 2.5);
  assert.ok(closest(spots, spread, dup) >= 2.5);
  assert.ok(closest(spots, spread, alike) >= 2.5);
  assert.ok(closest(spots, spread, dup) > closest(spots, plain, dup));
  assert.ok(closest(spots, spread, alike) > closest(spots, plain, alike));
});

test('stripLoops: neighbouring strips never share a clip or a duplicate, and a strip repeats a clip only a whole loop apart', () => {
  const R = atlasLike();
  const loops = stripLoops(24, R);
  assert.equal(loops[0].length + loops[1].length, 24);
  assert.equal(new Set([...loops[0], ...loops[1]]).size, 24);
  for (const places of [20, 21, 11, 13, 4]) {
    // Five rows, like Tilted plane's (20 places), the marquee's (11) or the columns' (4).
    const rows = Array.from({ length: 5 }, (_, r) => stripSequence(loops, r, places, R));
    for (let r = 0; r < 4; r++)
      for (const a of rows[r]) for (const b of rows[r + 1]) assert.ok(a !== b && R[a][b] >= 0.04, `${places}: rows ${r}/${r + 1}: ${a} ~ ${b}`);
    // Along a row, and round its wrap: the same clip comes back no sooner than 6 places on, a duplicate no sooner than 4.
    const period = Math.min(places, 6);
    for (const row of rows) {
      const ring = [...row, ...row];
      for (let i = 0; i < places; i++)
        for (let k = 1; k < Math.min(period, places); k++) {
          assert.notEqual(ring[i], ring[i + k], `${places}: same clip ${k} apart`);
          if (k < Math.min(3, period)) assert.ok(R[ring[i]][ring[i + k]] >= 0.04, `${places}: duplicate ${k} apart`);
        }
    }
  }
});

test('stripLoops: with 48 clips, three sets, so strips up to two apart never share a clip, and none comes back within two places', () => {
  const R = atlasLike(48);
  assert.equal(stripSetCount(48), 3);
  const loops = stripLoops(48, R);
  assert.equal(loops.length, 3);
  assert.equal(new Set(loops.flat()).size, 48);
  for (const places of [20, 7, 11, 13, 4]) {
    // Tilted plane's rows on a desktop (20 places), on a phone (7), the marquee's (11), the columns' (4).
    const rows = Array.from({ length: 9 }, (_, r) => stripSequence(loops, r, places, R));
    for (let r = 0; r < rows.length; r++)
      for (const o of [r + 1, r + 2].filter((o) => o < rows.length))
        for (const a of rows[r]) for (const b of rows[o]) assert.ok(a !== b && R[a][b] >= 0.04, `${places}: rows ${r}/${o}: ${a} ~ ${b}`);
    for (const row of rows) {
      const ring = [...row, ...row];
      for (let i = 0; i < places; i++) for (let k = 1; k <= Math.min(2, places - 1); k++) assert.notEqual(ring[i], ring[i + k], `${places}: same clip ${k} apart`);
    }
  }
});

test('stripLoops keeps the same footage in one loop, half of it apart, and shares look-alikes out', () => {
  const R = atlasLike();
  const loops = stripLoops(24, R);
  const loop = loops.find((l) => l.includes(0))!;
  assert.ok(loop.includes(9), '0 and 9 (one clip) in one set');
  const gap = Math.abs(loop.indexOf(0) - loop.indexOf(9));
  assert.equal(Math.min(gap, loop.length - gap), loop.length / 2);
  // A cluster of four look-alikes splits two and two.
  const cluster = atlasLike();
  for (const [a, b] of [[3, 19], [8, 19], [5, 19], [5, 8], [3, 5], [3, 8]]) cluster[a][b] = cluster[b][a] = 0.08;
  const split = stripLoops(24, cluster);
  const inFirst = [3, 19, 8, 5].filter((c) => split[0].includes(c)).length;
  assert.equal(inFirst, 2);
});
