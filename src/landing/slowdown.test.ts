import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slowdown } from './slowdown.ts';

test('coast slows over much longer than decelerate, outlasting the exits', () => {
  const pace = 1800;
  const coast = slowdown('coast', pace)!;
  const quick = slowdown('decelerate', pace)!;
  assert.ok(coast.ms > 4 * quick.ms);
  assert.ok(coast.ms > pace + 1000);
  // Still clearly moving as the tiles leave (they go from 140 ms to about the pace).
  const at = (ms: number) => coast.rate(ms / coast.ms);
  assert.ok(at(500) > 0.6);
  assert.ok(at(pace / 2) > 0.4);
  assert.ok(at(pace) > 0.1);
});

test('the speed falls smoothly to rest: no step, and no lurch at the end', () => {
  for (const motion of ['coast', 'decelerate'] as const) {
    const { rate } = slowdown(motion, 1800)!;
    assert.equal(rate(0), 1);
    assert.equal(rate(1), 0);
    let prev = 1;
    for (let t = 0.01; t <= 1.0001; t += 0.01) {
      const r = rate(Math.min(t, 1));
      assert.ok(r <= prev && prev - r < 0.03, `${motion} at ${t.toFixed(2)}`);
      prev = r;
    }
    // Arrives at rest gently (the speed's own slope is ~0 there).
    assert.ok(rate(0.99) < 0.001);
  }
});

test('freeze and flow have no slowdown', () => {
  assert.equal(slowdown('freeze', 1800), null);
  assert.equal(slowdown('flow', 1800), null);
});
