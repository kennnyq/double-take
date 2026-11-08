import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_GESTURES } from './settings.ts';
import { gestureAction, gestureOptions, isDoubleTap, revealHow, revealsWith, spaceWaitsForHold } from './gesture.ts';

const tells = { hasTells: true, canBoost: true };
const noTells = { hasTells: false, canBoost: true };

test('hold mode: hold reveals, double tap still likes', () => {
  assert.equal(gestureAction('hold', 'hold', tells), 'reveal');
  assert.equal(gestureAction('doubleTap', 'hold', tells), 'like');
});

test('double-tap mode: double tap reveals (no like), hold still boosts', () => {
  assert.equal(gestureAction('doubleTap', 'doubleTap', tells), 'reveal');
  assert.equal(gestureAction('hold', 'doubleTap', tells), 'boost');
});

test('both: either gesture reveals, so neither likes nor boosts', () => {
  assert.equal(gestureAction('doubleTap', 'both', tells), 'reveal');
  assert.equal(gestureAction('hold', 'both', tells), 'reveal');
  assert.equal(revealsWith('hold', 'both') && revealsWith('doubleTap', 'both'), true);
});

test('clips without tells keep the usual gestures in every mode', () => {
  for (const mode of REVEAL_GESTURES) {
    assert.equal(gestureAction('hold', mode, noTells), 'boost');
    assert.equal(gestureAction('doubleTap', mode, noTells), 'like');
  }
});

test('desktop has no boost: a hold that does not reveal does nothing', () => {
  assert.equal(gestureAction('hold', 'doubleTap', { hasTells: true, canBoost: false }), 'none');
  assert.equal(gestureAction('hold', 'hold', { hasTells: false, canBoost: false }), 'none');
});

test('Space waits for a hold only when hold opens this clip', () => {
  assert.equal(spaceWaitsForHold('hold', true), true);
  assert.equal(spaceWaitsForHold('both', true), true);
  assert.equal(spaceWaitsForHold('doubleTap', true), false, 'pauses at once');
  assert.equal(spaceWaitsForHold('hold', false), false, 'no tells: pauses at once');
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

test('the wording names each layout’s gestures', () => {
  assert.equal(revealHow('both', true), 'hold Space or double-click');
  assert.equal(revealHow('both', false), 'hold or double-tap a clip');
  assert.equal(revealHow('doubleTap', true), 'double-click the video');
  assert.deepEqual(
    gestureOptions(true).map((o) => o.title),
    ['Hold Space', 'Double-click', 'Both'],
  );
  assert.deepEqual(
    gestureOptions(false).map((o) => o.id),
    [...REVEAL_GESTURES],
  );
});
