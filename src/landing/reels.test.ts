import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextGap, pickSwipe, REEL_PACES, snap, SWIPE_MS, swipeSlices, type ReelTile } from './reels.ts';

test('snap: continuous, quick to leave, soft to settle, never overshooting', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(1), 1);
  let prev = 0;
  for (let t = 0.01; t <= 1; t += 0.01) {
    const v = snap(t);
    assert.ok(v >= prev - 1e-9 && v <= 1 + 1e-9, `at ${t}`);
    // No jump between neighbouring moments.
    assert.ok(v - prev < 0.06, `jump at ${t.toFixed(2)}: ${(v - prev).toFixed(3)}`);
    prev = v;
  }
  // Most of the way there in the first third, then a long soft landing.
  assert.ok(snap(1 / 3) > 0.7);
  assert.ok(1 - snap(0.9) < 0.02);
  assert.ok(SWIPE_MS >= 350 && SWIPE_MS <= 500);
});

const D = { sw: 144, sh: 256, dx: 10, dy: 20, dw: 132, dh: 234 };
const FROM = { sx: 0, sy: 0 };
const TO = { sx: 288, sy: 256 };

test('swipeSlices: the old clip slides up and out, the new one in from below', () => {
  assert.deepEqual(swipeSlices(0, D, FROM, TO), [{ ...FROM, sw: 144, sh: 256, dx: 10, dy: 20, dw: 132, dh: 234 }]);
  assert.deepEqual(swipeSlices(1, D, FROM, TO), [{ ...TO, sw: 144, sh: 256, dx: 10, dy: 20, dw: 132, dh: 234 }]);
  const [old, next] = swipeSlices(0.25, D, FROM, TO);
  // The old clip shows its lower three quarters at the top of the tile.
  assert.equal(old.sy, 64);
  assert.equal(old.sh, 192);
  assert.equal(old.dy, 20);
  // The new clip's top quarter fills the bottom of the tile.
  assert.equal(next.sy, 256);
  assert.equal(next.sh, 64);
  assert.equal(next.dy, 20 + 0.75 * 234);
});

test('swipeSlices always fill the tile exactly, and never spill out of it', () => {
  for (const p of [0.1, 0.5, 0.93]) {
    const s = swipeSlices(p, D, FROM, TO);
    assert.equal(s.reduce((n, x) => n + x.dh, 0), D.dh);
    assert.equal(s[0].dy, D.dy);
    assert.equal(s[1].dy + s[1].dh, D.dy + D.dh);
  }
});

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
const tile = (key: string, x: number, cell: number, last = 0): ReelTile => ({ key, x, y: 0, size: 100, cell, last });

test('pickSwipe waits until a tile is due', () => {
  const tiles = [tile('a', 0, 0, 10_000), tile('b', 500, 1, 12_000)];
  assert.equal(pickSwipe(tiles, 24, 20_000, REEL_PACES.sometimes), null);
  assert.equal(pickSwipe(tiles, 24, 24_100, REEL_PACES.sometimes, seq(0))?.key, 'a');
});

test('pickSwipe moves a tile to a clip not shown near it, preferring the least shown', () => {
  // a is the one due; b and c are near it (within 3 tile sizes), d is far away.
  const tiles = [tile('a', 0, 0), tile('b', 150, 1, 1e9), tile('c', 250, 2, 1e9), tile('d', 2000, 3, 1e9)];
  const picks = new Set<number>();
  for (let r = 0; r < 1; r += 0.05) picks.add(pickSwipe(tiles, 5, 100_000, REEL_PACES.sometimes, seq(0, r))!.cell);
  // Not its own clip, not a neighbour's, and not clip 3 (already on screen) while 4 is shown nowhere.
  assert.deepEqual([...picks], [4]);
});

test('pickSwipe takes a clip shown nearby only when it is far enough off, and otherwise holds off', () => {
  // Only clip 1 is left, and the tile showing it is 4 tiles away: fine.
  assert.equal(pickSwipe([tile('a', 0, 0), tile('b', 400, 1, 1e9)], 2, 100_000, REEL_PACES.sometimes, seq(0))!.cell, 1);
  // Half a tile away: it would sit right beside its double, so nothing swipes.
  assert.equal(pickSwipe([tile('a', 0, 0), tile('b', 50, 1, 1e9)], 2, 100_000, REEL_PACES.sometimes, seq(0)), null);
  assert.equal(pickSwipe([tile('a', 0, 0)], 1, 100_000, REEL_PACES.sometimes), null);
});

test('nextGap varies around the pace, never zero', () => {
  assert.equal(nextGap(REEL_PACES.sometimes, () => 0), 2.2 * 0.6);
  assert.equal(nextGap(REEL_PACES.sometimes, () => 1), 2.2 * 1.4);
});

test('pickSwipe avoids clips that look like the neighbours', () => {
  // 0 and 1 are one clip under two ids; 2 looks like 3; 4 is unlike anything.
  const D = [
    [0, 0.02, 0.3, 0.3, 0.3],
    [0.02, 0, 0.3, 0.3, 0.3],
    [0.3, 0.3, 0, 0.07, 0.3],
    [0.3, 0.3, 0.07, 0, 0.3],
    [0.3, 0.3, 0.3, 0.3, 0],
  ];
  // 'a' (showing 2) is due; 'b' beside it shows 0. Clips 1 (a duplicate of 0) and 3 (like 2... and next to nothing) compete with 4.
  const tiles = [tile('a', 0, 2), tile('b', 120, 0, 1e9), tile('c', 2000, 4, 1e9)];
  const pick = pickSwipe(tiles, 5, 100_000, REEL_PACES.sometimes, seq(0), D);
  // Not 0 or 1 (that's the clip beside it), not its own; 3 and 4 remain, and 4 is already far off on screen, so 3.
  assert.ok(pick!.cell !== 0 && pick!.cell !== 1 && pick!.cell !== 2, `picked ${pick!.cell}`);
});

test('pickSwipe keeps a tile to the clips it is allowed', () => {
  const tiles = [tile('a', 0, 2), tile('b', 3000, 7, 1e9)];
  for (let r = 0; r < 1; r += 0.1) {
    const pick = pickSwipe(tiles, 24, 100_000, REEL_PACES.sometimes, seq(0, r), undefined, () => [2, 11, 13]);
    assert.ok(pick!.cell === 11 || pick!.cell === 13, `picked ${pick!.cell}`);
  }
  assert.equal(pickSwipe(tiles, 24, 100_000, REEL_PACES.sometimes, seq(0), undefined, () => [2]), null);
});

test('pickSwipe swipes a tile that has drifted beside its own clip before one that has merely waited', () => {
  // All due; 'a' waited longest, but 'b' and 'c' show the same clip side by side.
  const tiles = [tile('a', 0, 0, 0), tile('b', 1000, 5, 20_000), tile('c', 1100, 5, 20_000), tile('d', 3000, 7, 20_000)];
  const pick = pickSwipe(tiles, 24, 100_000, REEL_PACES.sometimes, seq(0));
  assert.ok(pick!.key === 'b' || pick!.key === 'c', `picked ${pick!.key}`);
  assert.notEqual(pick!.cell, 5);
});

