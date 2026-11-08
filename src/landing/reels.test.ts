import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASH, chooseNext, FADE_MS, handover, loopAt, nextStart, NUDGE_FRAMES, snap, soft, SWIPE_MS, swipeSlices } from './reels.ts';

test('snap: continuous, quick to leave, soft to settle, never overshooting', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(1), 1);
  let prev = 0;
  for (let t = 0.01; t <= 1; t += 0.01) {
    const v = snap(t);
    assert.ok(v >= prev - 1e-9 && v <= 1 + 1e-9, `at ${t}`);
    assert.ok(v - prev < 0.06, `jump at ${t.toFixed(2)}: ${(v - prev).toFixed(3)}`);
    prev = v;
  }
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
  assert.equal(old.sy, 64);
  assert.equal(old.sh, 192);
  assert.equal(old.dy, 20);
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

test('loopAt and nextStart follow a cell round its loop from its phase', () => {
  assert.equal(loopAt(0, 2, 7), 2);
  assert.equal(loopAt(6, 2, 7), 1);
  // Phase 2: its loop starts at atlas time 5, 12, 19…
  assert.equal(nextStart(0, 2, 7), 5);
  assert.equal(nextStart(5, 2, 7), 5);
  assert.equal(nextStart(5.5, 2, 7), 12);
  // Anywhere on the timeline, nextStart lands on the loop's start.
  const at = loopAt(nextStart(31.3, 4.4, 7), 4.4, 7);
  assert.ok(Math.min(at, 7 - at) < 1e-9);
});

test('soft: the crossfade eases in and out, continuously', () => {
  assert.equal(soft(0), 0);
  assert.equal(soft(1), 1);
  assert.equal(soft(0.5), 0.5);
  assert.ok(soft(0.05) < 0.01 && 1 - soft(0.95) < 0.01);
  assert.equal(handover(7, 0.53, 2, FADE_MS).until, 7 - 0.53 - FADE_MS / 1000);
});

test('handover: gone before the closing dissolve, looking a while ahead', () => {
  const h = handover(7, 0.53, 2);
  assert.ok(Math.abs(h.until - (7 - 0.53 - SWIPE_MS / 1000)) < 1e-9);
  assert.ok(Math.abs(h.from - (h.until - 2)) < 1e-9);
  assert.equal(handover(1, 0.5, 2).from, 0);
});

// Six cells, starting at atlas times 1, 2, 3, 4, 5, 6 (mod 7).
const PHASES = [6, 5, 4, 3, 2, 1];
const tile = { x: 0, y: 0, size: 100, cell: 0 };

test('chooseNext takes only clips starting before the tile must go, latest first', () => {
  // At t = 1.5, must start by 3.6: cells 1 (2) and 2 (3) qualify; the later one wins.
  const next = chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours: [] });
  assert.deepEqual(next, { cell: 2, at: 3 });
  assert.equal(chooseNext({ tile, t: 2.5, until: 2.9, phases: PHASES, loop: 7, neighbours: [] }), null);
});

test('chooseNext skips a clip shown beside the tile, and look-alikes', () => {
  const neighbours = [{ x: 100, y: 0, cell: 2 }];
  assert.deepEqual(chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours }), { cell: 1, at: 2 });
  // Cell 1 looks just like cell 2 (the same footage): neither will do.
  const d = Array.from({ length: 6 }, () => new Array<number>(6).fill(0.3));
  d[1][2] = d[2][1] = 0.02;
  assert.equal(chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours, distances: d }), null);
});

test('chooseNext spreads swipes apart, and prefers the strip\'s own set', () => {
  // Another swipe is due at 3: take the one at 2 instead.
  assert.deepEqual(chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours: [], busy: [3 + CLASH / 2] }), { cell: 1, at: 2 });
  // Swipes at 2 and 3 already: nudge one a frame or two rather than start together.
  const next = chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours: [], busy: [2, 3] })!;
  assert.ok([2, 3].every((b) => Math.abs(next.at - b) >= 1 / 15 - 1e-9), `at ${next.at}`);
  assert.ok(next.at - Math.floor(next.at) <= NUDGE_FRAMES / 15 + 1e-9);
  assert.deepEqual(chooseNext({ tile, t: 1.5, until: 3.6, phases: PHASES, loop: 7, neighbours: [], prefer: [1] }), { cell: 1, at: 2 });
});
