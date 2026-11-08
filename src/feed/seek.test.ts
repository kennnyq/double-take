import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, fracAt, pressIntent, seekBy, timeLabel } from './seek.ts';

test('fracAt clamps to the bar', () => {
  assert.equal(fracAt(50, 200), 0.25);
  assert.equal(fracAt(-10, 200), 0);
  assert.equal(fracAt(250, 200), 1);
  assert.equal(fracAt(10, 0), 0);
});

test('formatTime and timeLabel', () => {
  assert.equal(formatTime(7.9), '0:07');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(timeLabel(7, 15.2), '0:07 / 0:15');
});

test('seekBy stays inside the clip, short of the end', () => {
  assert.equal(seekBy(3, 5, 20), 8);
  assert.equal(seekBy(3, -5, 20), 0);
  assert.equal(seekBy(18, 5, 20), 19.75);
  assert.equal(seekBy(3, 5, 0), 0);
});

test('pressIntent: small moves tap, sideways drags, up/down swipes the feed', () => {
  assert.equal(pressIntent(2, 3), 'tap');
  assert.equal(pressIntent(20, 5), 'drag');
  assert.equal(pressIntent(-20, 8), 'drag');
  assert.equal(pressIntent(4, 30), 'swipe');
});
