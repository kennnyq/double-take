import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gestureAction, isDoubleTap, revealHint } from './gesture.ts';

const tells = { hasTells: true, canBoost: true };
const noTells = { hasTells: false, canBoost: true };

test('hold mode: hold reveals, double tap still likes', () => {
  assert.equal(gestureAction('hold', 'hold', tells), 'reveal');
  assert.equal(gestureAction('doubleTap', 'hold', tells), 'like');
});

test('double-tap mode: double tap reveals, hold still boosts', () => {
  assert.equal(gestureAction('doubleTap', 'doubleTap', tells), 'reveal');
  assert.equal(gestureAction('hold', 'doubleTap', tells), 'boost');
});

test('clips without tells keep the usual gestures', () => {
  assert.equal(gestureAction('hold', 'hold', noTells), 'boost');
  assert.equal(gestureAction('doubleTap', 'doubleTap', noTells), 'like');
});

test('desktop has no boost: a hold that does not reveal does nothing', () => {
  assert.equal(gestureAction('hold', 'doubleTap', { hasTells: true, canBoost: false }), 'none');
  assert.equal(gestureAction('hold', 'hold', { hasTells: false, canBoost: false }), 'none');
});

test('isDoubleTap needs a second tap soon and nearby', () => {
  const a = { t: 1000, x: 100, y: 100 };
  assert.equal(isDoubleTap(null, a, 280), false);
  assert.equal(isDoubleTap(a, { t: 1200, x: 110, y: 95 }, 280), true);
  assert.equal(isDoubleTap(a, { t: 1300, x: 100, y: 100 }, 280), false, 'too slow');
  assert.equal(isDoubleTap(a, { t: 1100, x: 200, y: 100 }, 280), false, 'too far');
  assert.equal(isDoubleTap(a, { t: 900, x: 100, y: 100 }, 280), false, 'clock went backwards');
  const nowhere = { t: 1000, x: NaN, y: NaN };
  assert.equal(isDoubleTap(nowhere, { t: 1100, x: NaN, y: NaN }, 280), true, 'no position: timing decides');
  assert.equal(isDoubleTap(nowhere, { t: 1400, x: NaN, y: NaN }, 280), false);
});

test('revealHint names the gesture for the layout', () => {
  assert.equal(revealHint('hold', false), 'Hold for a double take');
  assert.equal(revealHint('doubleTap', true), 'Double-click for a double take');
});
