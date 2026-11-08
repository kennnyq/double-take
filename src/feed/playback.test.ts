import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOST_RATE, IDLE, audibleSlots, guardOps, opsFor, planFor, type PlaybackState } from './playback.ts';

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

test('stopping a player pauses it first and never sets the rate (which plays on iOS)', () => {
  assert.deepEqual(opsFor({ muted: false, rate: 2 }, IDLE), ['pause', 'mute']);
  assert.deepEqual(opsFor({ muted: true, rate: 1 }, IDLE), ['pause']);
  const paused = planFor(true, { ...base, paused: true }, SLOW);
  assert.ok(!opsFor({ muted: false, rate: 2 }, paused).includes('rate'));
});

test('starting a player sets sound before speed, and only what changed', () => {
  const plan = planFor(true, { ...base, boost: true }, SLOW);
  assert.deepEqual(opsFor({ muted: true, rate: 1 }, plan), ['unmute', 'rate', 'play']);
  assert.deepEqual(opsFor({ muted: false, rate: 2 }, plan), ['play']);
});

test('pressing mute on the playing clip only mutes it', () => {
  const plan = planFor(true, { ...base, muted: true }, SLOW);
  assert.deepEqual(opsFor({ muted: false, rate: 1 }, plan), ['mute', 'play']);
});

test('the guard stops or mutes a player that drifted, and never starts one', () => {
  assert.deepEqual(guardOps({ muted: false, playing: true }, IDLE), ['pause', 'mute']);
  const mutedPlan = planFor(true, { ...base, muted: true }, SLOW);
  assert.deepEqual(guardOps({ muted: false, playing: true }, mutedPlan), ['mute']);
  assert.deepEqual(guardOps({ muted: true, playing: false }, planFor(true, base, SLOW)), []);
  assert.deepEqual(guardOps({ muted: false, playing: true }, planFor(true, base, SLOW)), []);
});

test('a scrub holds the active clip paused and silent, whatever else is asked', () => {
  for (const s of [base, { ...base, slowmo: true }, { ...base, boost: true }]) {
    const plan = planFor(true, { ...s, scrub: true }, SLOW);
    assert.equal(plan.play, false);
    assert.equal(plan.muted, true);
    // Stopping never touches the rate (on iOS that would start the player).
    assert.deepEqual(opsFor({ muted: false, rate: 1 }, plan), ['pause', 'mute']);
  }
  assert.deepEqual(planFor(false, { ...base, scrub: true }, SLOW), IDLE);
});
