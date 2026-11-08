import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOST_RATE, IDLE, audibleSlots, planFor, type PlaybackState } from './playback.ts';

const SLOW = 0.35;
const base: PlaybackState = { live: true, muted: false, paused: false, boost: false, slowmo: false };

test('only the active clip plays with sound', () => {
  const plans = [false, true, false].map((active) => planFor(active, base, SLOW));
  assert.deepEqual(audibleSlots(plans), [1]);
  assert.deepEqual(plans[0], IDLE);
  assert.deepEqual(plans[2], IDLE);
});

test('neighbours stay silent and paused whatever the active clip is doing', () => {
  const states: PlaybackState[] = [
    base,
    { ...base, boost: true },
    { ...base, slowmo: true },
    { ...base, paused: true },
    { ...base, muted: true },
  ];
  for (const s of states) assert.deepEqual(planFor(false, s, SLOW), IDLE);
});

test('mute applies to the active clip', () => {
  const p = planFor(true, { ...base, muted: true }, SLOW);
  assert.equal(p.muted, true);
  assert.equal(p.play, true);
  assert.deepEqual(audibleSlots([p]), []);
});

test('a paused clip is not heard', () => {
  assert.deepEqual(audibleSlots([planFor(true, { ...base, paused: true }, SLOW)]), []);
});

test('nothing plays when the feed is hidden or the app is in the background', () => {
  assert.deepEqual(planFor(true, { ...base, live: false }, SLOW), IDLE);
});

test('hold plays at 2x and letting go returns to normal speed', () => {
  assert.equal(planFor(true, { ...base, boost: true }, SLOW).rate, BOOST_RATE);
  assert.equal(planFor(true, base, SLOW).rate, 1);
});

test('the walkthrough replays slowly and muted, then sound comes back', () => {
  const slow = planFor(true, { ...base, slowmo: true }, SLOW);
  assert.equal(slow.rate, SLOW);
  assert.equal(slow.muted, true);
  const after = planFor(true, base, SLOW);
  assert.equal(after.muted, false);
  assert.equal(after.rate, 1);
});
