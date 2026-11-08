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

test('inspectInset: same gap at the sides and top, corners concentric with the display', () => {
  const { scale, dy, radius } = inspectInset(430, 860, 55, 12);
  close(430 * scale, 430 - 24);
  // Top edge after scaling about the centre, then moving by dy.
  close(860 / 2 - (860 * scale) / 2 + dy, 12);
  close(radius * scale, 55 - 12);
  assert.deepEqual(inspectInset(0, 0, 55), { scale: 1, dy: 0, radius: 0 });
});
