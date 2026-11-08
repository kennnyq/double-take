import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIRI, WWDC_TOTAL_MS, WWDC_UNIT_MS, dampedSpring, easeIn, linesFromTops, revealFrame, revealMetrics, revealPlan, revealWords, siriUnit, wwdcStep } from './reveal.ts';

const m = revealMetrics({ fontSize: 15, lineHeight: 20 });

test('siri: each line starts about 1.2 line heights below, unseen, and rises into place', () => {
  const u = siriUnit(0, 0);
  const start = revealFrame('siri', 0, u, m);
  assert.equal(start.opacity, 0);
  assert.ok(Math.abs(start.translateY - SIRI.rise * m.lineHeight) < 1e-9 && start.translateY > 0, 'below its place');
  assert.equal(start.blur, 0);
  const end = revealFrame('siri', 2000, u, m);
  assert.equal(end.opacity, 1);
  assert.equal(end.translateY, 0);
});

test('siri: the rise overshoots only a little (~6 %) and settles', () => {
  let min = 1;
  for (let t = 0; t <= 800; t += 2) min = Math.min(min, dampedSpring(t, SIRI.damping, SIRI.response));
  assert.ok(min < -0.04 && min > -0.09, `${min}`);
  assert.equal(revealFrame('siri', SIRI.settle, siriUnit(0, 0), m).translateY, 0);
});

test('siri: lines start 20 ms apart, so the gap to the next line starts wide and closes', () => {
  const a = siriUnit(0, 0);
  const b = siriUnit(1, 0);
  assert.equal(b.move - a.move, SIRI.lineStagger);
  assert.ok(b.rise! > a.rise!, 'each next line starts a little further down');
  const gap = (ms: number) => m.lineHeight + revealFrame('siri', ms, b, m).translateY - revealFrame('siri', ms, a, m).translateY;
  assert.ok(gap(80) > gap(200) && gap(200) > m.lineHeight, `${gap(80)} ${gap(200)}`);
  assert.ok(Math.abs(gap(2000) - m.lineHeight) < 1e-9);
});

test('siri: words fade in as their line starts moving, left to right', () => {
  const left = siriUnit(2, 0);
  const right = siriUnit(2, 1);
  assert.equal(left.move, right.move);
  assert.equal(left.fade, left.move + SIRI.fadeDelay);
  assert.ok(left.fade >= left.move);
  assert.equal(right.fade - left.fade, SIRI.sweep);
});

test('revealPlan: the hint comes as one more line; everything settles in well under a second', () => {
  const p = revealPlan('siri', [0, 0, 0, 1, 1, 2], [0.1, 0.5, 0.9, 0.2, 0.7, 0.3]);
  assert.equal(p.units.length, 6);
  assert.equal(p.hint.move, 3 * SIRI.lineStagger);
  assert.ok(p.total < 800, `${p.total}`);
});

test('wwdc: Apple’s pacing (0.9 s in all) and its slight blur', () => {
  assert.ok(Math.abs(wwdcStep(14) - 35.7) < 0.1);
  for (const n of [1, 3, 13, 40]) {
    const p = revealPlan('wwdc', Array(n).fill(0), Array(n).fill(0));
    assert.ok(p.total <= WWDC_TOTAL_MS + 1e-9, `${n}: ${p.total}`);
  }
  const f = revealFrame('wwdc', 0, { move: 0, fade: 0 }, m);
  assert.equal(f.opacity, 0);
  assert.ok(f.translateY < 0, 'drops from above');
  assert.equal(f.blur, m.lineHeight / 16);
  assert.deepEqual(revealFrame('wwdc', WWDC_UNIT_MS, { move: 0, fade: 0 }, m), { opacity: 1, translateY: -0, blur: 0 });
});

test('easeIn is CSS ease-in', () => {
  assert.equal(easeIn(0), 0);
  assert.equal(easeIn(1), 1);
  assert.ok(Math.abs(easeIn(0.5) - 0.315) < 0.01);
});

test('linesFromTops groups words by their top, a few px apart at most', () => {
  assert.deepEqual(linesFromTops([0, 0.5, 1, 20, 20, 40.4, 39.8]), [0, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual(revealWords('  a  b\nc '), ['a', 'b', 'c']);
});
