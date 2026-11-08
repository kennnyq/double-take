import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAudio, type PlayerSnapshot } from './audioDebug.ts';

const idle = (slot: number, index: number): PlayerSnapshot => ({
  slot,
  index,
  loaded: true,
  active: false,
  muted: true,
  playing: false,
  volume: 1,
  rate: 1,
  status: 'readyToPlay',
});
const on = (slot: number, index: number): PlayerSnapshot => ({ ...idle(slot, index), active: true, muted: false, playing: true });

test('a healthy pool reports no problems', () => {
  const r = describeAudio(false, 4, [idle(0, 3), on(1, 4), idle(2, 5)]);
  assert.deepEqual(r.problems, []);
  assert.match(r.line, /mute=off active=#4 \| s0 #3 stop muted .* \| s1 #4\* play SOUND/);
});

test('doubled audio, sound while muted and off-screen playback are flagged', () => {
  const r = describeAudio(true, 4, [{ ...idle(0, 3), playing: true, muted: false }, on(1, 4), idle(2, 5)]);
  assert.equal(r.problems.length, 4);
  assert.match(r.problems[0], /2 players audible/);
  assert.match(r.problems[1], /muted, but/);
  assert.match(r.problems[2], /slot 0 \(#3\) is audible but not the active clip/);
  assert.match(r.problems[3], /slot 0 \(#3\) plays off screen/);
});
