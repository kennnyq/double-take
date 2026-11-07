import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip, Verdict } from '../data/clips.ts';
import { autoLabel, clipsForMode, isAppend, keepPosition, modeFilter, shownIndexOf } from './feedMode.ts';

const clip = (i: number, verdict?: Verdict) => ({ id: `clip-${i}`, verdict }) as Clip;
// Two AI clips, a real one, then unknown placeholders.
const ALL = [clip(0, 'ai'), clip(1, 'real'), clip(2, 'ai'), clip(3), clip(4)];

test('modeFilter', () => {
  assert.equal(modeFilter('default'), null);
  assert.equal(modeFilter('autoLabel'), null);
  assert.equal(modeFilter('onlyAi'), 'ai');
  assert.equal(modeFilter('onlyReal'), 'real');
});

test('clipsForMode keeps everything (same array) unless filtering', () => {
  assert.equal(clipsForMode(ALL, 'default'), ALL);
  assert.equal(clipsForMode(ALL, 'autoLabel'), ALL);
});

test('clipsForMode filters by verdict and drops unknown clips', () => {
  assert.deepEqual(clipsForMode(ALL, 'onlyAi').map((c) => c.id), ['clip-0', 'clip-2']);
  assert.deepEqual(clipsForMode(ALL, 'onlyReal').map((c) => c.id), ['clip-1']);
  assert.deepEqual(clipsForMode([clip(0)], 'onlyReal'), []);
});

test('autoLabel shows the verdict only in autoLabel mode, and only when known', () => {
  assert.equal(autoLabel(clip(0, 'ai'), 'autoLabel'), 'ai');
  assert.equal(autoLabel(clip(1, 'real'), 'autoLabel'), 'real');
  assert.equal(autoLabel(clip(3), 'autoLabel'), null);
  assert.equal(autoLabel(clip(0, 'ai'), 'default'), null);
  assert.equal(autoLabel(clip(0, 'ai'), 'onlyAi'), null);
});

test('shownIndexOf maps feed indexes into a filtered feed', () => {
  const ai = clipsForMode(ALL, 'onlyAi');
  assert.equal(shownIndexOf(ai, 0), 0);
  assert.equal(shownIndexOf(ai, 2), 1, 'shown clip');
  assert.equal(shownIndexOf(ai, 1), 1, 'hidden clip → next shown');
  assert.equal(shownIndexOf(ai, 4), 1, 'past the end → last');
  assert.equal(shownIndexOf([], 3), 0);
});

test('keepPosition stays on the same clip, else the nearest after it', () => {
  const ai = clipsForMode(ALL, 'onlyAi');
  assert.equal(keepPosition(ALL, ai, 2), 1, 'clip-2 is still shown');
  assert.equal(keepPosition(ALL, ai, 1), 1, 'clip-1 hidden → clip-2');
  assert.equal(keepPosition(ALL, ai, 4), 1, 'nothing after → last');
  assert.equal(keepPosition(ai, ALL, 1), 2, 'back to everything');
  assert.equal(keepPosition(ALL, [], 2), 0);
  assert.equal(keepPosition(ALL, ALL.map((c) => ({ ...c })), 3), 3, 'same clip, new object');
});

test('isAppend', () => {
  assert.equal(isAppend(ALL, [...ALL, clip(5)]), true);
  assert.equal(isAppend(ALL, ALL), true);
  assert.equal(isAppend(ALL, ALL.map((c) => ({ ...c }))), true, 'compares ids, not objects');
  assert.equal(isAppend(ALL, clipsForMode(ALL, 'onlyAi')), false);
  assert.equal(isAppend(ALL.slice(0, 2), [ALL[0], clip(9)]), false);
});
