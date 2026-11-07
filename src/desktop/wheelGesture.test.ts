import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WheelGestureDetector, normalizeWheelDelta } from './wheelGesture.ts';

type Sample = [deltaY: number, t: number];

function run(samples: Sample[], d = new WheelGestureDetector()) {
  const moves: { dir: number; t: number }[] = [];
  for (const [dy, t] of samples) {
    const dir = d.push(dy, t);
    if (dir !== 0) moves.push({ dir, t });
  }
  return moves;
}

/** A macOS-style trackpad flick: quick ramp-up, then ~1s of decaying momentum. */
function flick(start: number, peak = 60, sign = 1, frames = 70): Sample[] {
  const out: Sample[] = [];
  const ramp = [0.1, 0.3, 0.6, 0.9, 1];
  let t = start;
  for (const r of ramp) {
    out.push([sign * peak * r, t]);
    t += 16;
  }
  let v = peak;
  for (let i = 0; i < frames; i++) {
    v *= 0.93;
    out.push([sign * Math.max(0.5, Math.round(v * 10) / 10), t]);
    t += 16;
  }
  return out;
}

describe('WheelGestureDetector', () => {
  it('moves exactly one item for a single trackpad flick including momentum', () => {
    const moves = run(flick(0));
    assert.equal(moves.length, 1);
    assert.ok(moves[0].t <= 32); // responds within two frames
  });

  it('moves one item for a hard flick with integer (Safari-style) momentum', () => {
    const samples = flick(0, 140).map(([dy, t]) => [Math.round(dy), t] as Sample);
    assert.equal(run(samples).length, 1);
  });

  it('ignores a tiny accidental nudge', () => {
    assert.equal(run([[3, 0], [4, 16], [2, 32]]).length, 0);
  });

  it('recognises a second flick made during the first flick momentum', () => {
    const first = flick(0, 60, 1, 20); // momentum still running at t≈400ms
    const lastT = first[first.length - 1][1];
    const second = flick(lastT + 16, 70);
    const moves = run([...first, ...second]);
    assert.deepEqual(moves.map((m) => m.dir), [1, 1]);
  });

  it('treats a reversal as a new gesture immediately', () => {
    const down = flick(0, 60, 1, 12);
    const lastT = down[down.length - 1][1];
    const up = flick(lastT + 16, 60, -1);
    assert.deepEqual(run([...down, ...up]).map((m) => m.dir), [1, -1]);
  });

  it('moves once per separate mouse-wheel tick', () => {
    const ticks: Sample[] = [[40, 0], [40, 300], [-40, 600]];
    assert.deepEqual(run(ticks).map((m) => m.dir), [1, 1, -1]);
  });

  it('advances at a controlled rate while a notched wheel spins continuously', () => {
    const spin: Sample[] = Array.from({ length: 20 }, (_, i) => [40, i * 50]);
    const moves = run(spin);
    assert.ok(moves.length >= 2);
    assert.ok(moves.length <= 4);
  });

  it('does not re-fire during a slow, noisy continued drag', () => {
    const noisy = [3, 5, 8, 6, 9, 7, 4, 8, 10, 6, 9, 12, 8, 5, 7, 9, 11, 6, 4, 3];
    const samples: Sample[] = noisy.map((v, i) => [v, i * 16]);
    assert.equal(run(samples).length, 1);
  });

  it('starts fresh after an idle gap', () => {
    const a = flick(0, 60, 1, 10);
    const b = flick(2000, 60, 1, 10);
    assert.equal(run([...a, ...b]).length, 2);
  });
});

describe('normalizeWheelDelta', () => {
  it('converts lines and pages to pixels', () => {
    assert.equal(normalizeWheelDelta(3, 1, 800), 48);
    assert.equal(normalizeWheelDelta(1, 2, 800), 800);
    assert.equal(normalizeWheelDelta(12.5, 0, 800), 12.5);
  });
});
