import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayCornerRadius, inspectInset } from './shrink.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('displayCornerRadius knows current iPhones, either orientation', () => {
  assert.equal(displayCornerRadius(430, 932, 'ios'), 55);
  assert.equal(displayCornerRadius(932, 430, 'ios'), 55);
  assert.equal(displayCornerRadius(402, 874, 'ios'), 62);
  assert.equal(displayCornerRadius(375, 667, 'ios'), 0); // home-button iPhone: square corners
  assert.ok(displayCornerRadius(400, 900, 'ios') > 0); // unknown notched phone
  assert.ok(displayCornerRadius(412, 915, 'android') > 0);
});

test('inspectInset: centred below the Dynamic Island, clear of every edge, corners following the display', () => {
  const W = 430;
  const H = 858;
  const safeTop = 59;
  const { scale, dy, radius } = inspectInset(W, H, 55, safeTop, 12);
  const top = H / 2 - (H * scale) / 2 + dy;
  const bottom = H / 2 + (H * scale) / 2 + dy;
  close(top, safeTop + 12);
  close(bottom, H - 12);
  const side = (W - W * scale) / 2;
  assert.ok(side >= 12, `side gap ${side}`);
  close(radius * scale, 55 - side);
  assert.deepEqual(inspectInset(0, 0, 55), { scale: 1, dy: 0, radius: 0 });
});

test('inspectInset: without a notch it’s centred with equal gaps', () => {
  const { scale, dy } = inspectInset(400, 800, 0, 0, 12);
  close(400 * scale, 400 - 24);
  close(dy, 0);
});
