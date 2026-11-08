import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRUB_DEFAULTS, easeInOut, maxStep, planScrub, scrubTimeAt } from './scrub.ts';

test('planScrub: nothing to do when already there', () => {
  assert.equal(planScrub(3, 3.01).ms, 0);
  assert.equal(scrubTimeAt(planScrub(3, 3.01), 0), 3.01);
});

test('planScrub: short moves still take the minimum, long ones are capped', () => {
  assert.equal(planScrub(1, 1.2).ms, Math.round(SCRUB_DEFAULTS.minMs + 0.2 * SCRUB_DEFAULTS.msPerSecond));
  assert.equal(planScrub(0, 60).ms, SCRUB_DEFAULTS.maxMs);
  assert.ok(planScrub(0, 2).ms < planScrub(0, 4).ms, 'further takes longer');
});

test('planScrub: rewinding takes as long as fast-forwarding the same distance', () => {
  assert.equal(planScrub(8, 2).ms, planScrub(2, 8).ms);
});

test('scrubTimeAt runs from start to target, monotonically, and lands exactly', () => {
  for (const [from, to] of [
    [1, 9],
    [9, 1],
  ]) {
    const plan = planScrub(from, to);
    assert.equal(scrubTimeAt(plan, 0), from);
    assert.equal(scrubTimeAt(plan, plan.ms), to);
    assert.equal(scrubTimeAt(plan, plan.ms + 500), to);
    let prev = from;
    for (let ms = 0; ms <= plan.ms; ms += 5) {
      const t = scrubTimeAt(plan, ms);
      assert.ok(to > from ? t >= prev - 1e-9 : t <= prev + 1e-9, `monotonic at ${ms}`);
      prev = t;
    }
  }
});

test('scrubTimeAt eases: slow at the ends, fast in the middle', () => {
  const plan = planScrub(0, 10);
  const step = (at: number) => Math.abs(scrubTimeAt(plan, at + 10) - scrubTimeAt(plan, at));
  assert.ok(step(0) < step(plan.ms / 2 - 5) / 4);
  assert.ok(step(plan.ms - 10) < step(plan.ms / 2 - 5) / 4);
});

test('maxStep bounds every seek of the scrub', () => {
  for (const d of [0.5, 3, 8, 20]) {
    const plan = planScrub(0, d);
    let biggest = 0;
    for (let ms = 0; ms + plan.stepMs <= plan.ms; ms += 1) {
      biggest = Math.max(biggest, Math.abs(scrubTimeAt(plan, ms + plan.stepMs) - scrubTimeAt(plan, ms)));
    }
    assert.ok(biggest <= maxStep(plan) + 1e-9, `${d}s: ${biggest} <= ${maxStep(plan)}`);
  }
  // A typical move between tells stays well under a second per seek.
  assert.ok(maxStep(planScrub(2, 9)) < 0.5);
});

test('easeInOut is clamped', () => {
  assert.equal(easeInOut(-1), 0);
  assert.equal(easeInOut(2), 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
});

test('safeSeek drops times that aren’t numbers, keeps inside the clip and never throws', async () => {
  const { safeSeek } = await import('./scrub.ts');
  const p = { currentTime: 3, duration: 10 };
  safeSeek(p, NaN);
  assert.equal(p.currentTime, 3);
  safeSeek(p, Infinity);
  assert.equal(p.currentTime, 3);
  safeSeek(p, 50);
  assert.equal(p.currentTime, 9.95);
  safeSeek(p, -2);
  assert.equal(p.currentTime, 0);
  const unknown = { currentTime: 0, duration: NaN };
  safeSeek(unknown, 4);
  assert.equal(unknown.currentTime, 4);
  const angry = {
    get currentTime() {
      return 0;
    },
    set currentTime(_v: number) {
      throw new Error('not ready');
    },
  };
  assert.doesNotThrow(() => safeSeek(angry, 1));
});
