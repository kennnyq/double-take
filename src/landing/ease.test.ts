import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easingCurve, neverFaster } from './ease.ts';

/** The (output, input) points of a linear() easing. */
function points(css: string): [number, number][] {
  return css
    .slice('linear('.length, -1)
    .split(', ')
    .map((pt) => {
      const [y, x] = pt.split(' ');
      return [Number(y), parseFloat(x) / 100];
    });
}

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('easingCurve: reads keywords and cubic-bezier()', () => {
  close(easingCurve('linear')!(0.3), 0.3);
  assert.ok(easingCurve('ease-out')!(0.5) > 0.5);
  assert.equal(easingCurve('cubic-bezier(.35,0,.25,1)')!(1), 1);
  assert.equal(easingCurve('steps(4)'), null);
});

test('neverFaster: leaves an easing alone where it only slows down from p', () => {
  assert.equal(neverFaster('ease-out', 0.2), null);
  assert.equal(neverFaster('cubic-bezier(.35,0,.25,1)', 0.8), null);
});

test('neverFaster: keeps where it is at p, and never goes faster than it was there', () => {
  const css = 'cubic-bezier(.35,0,.25,1)';
  const f = easingCurve(css)!;
  for (const p of [0.05, 0.15, 0.25]) {
    const out = neverFaster(css, p);
    assert.ok(out, `reshaped at ${p}`);
    const pts = points(out);
    const at = pts.find(([, x]) => Math.abs(x - p) < 1e-6);
    assert.ok(at);
    close(at[0], f(p));
    const speed = (f(p + 1e-3) - f(p - 1e-3)) / 2e-3;
    const after = pts.filter(([, x]) => x >= p - 1e-6);
    for (let i = 1; i < after.length; i++) {
      const v = (after[i][0] - after[i - 1][0]) / (after[i][1] - after[i - 1][1]);
      assert.ok(v <= speed + 1e-3, `${v} > ${speed} after ${p}`);
      assert.ok(v >= 0);
    }
  }
});

test('neverFaster: slows a falling (ease-in) exit rather than letting it speed up', () => {
  assert.match(neverFaster('cubic-bezier(.5,0,.9,.5)', 0.5) ?? '', /^linear\(/);
});
