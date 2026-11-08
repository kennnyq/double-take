import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRESH, SHOW_DELAY_MS, HINT_DELAYS, demoCaption, recordOpen, parseProgress, shouldShow } from './hints.ts';
const clip = { hasTells: true, blocked: false };
test('every reel remains eligible until the first walkthrough opening', () => {
  for (let reel = 0; reel < 20; reel++) assert.equal(shouldShow(FRESH, clip), true);
  const completed = recordOpen(FRESH);
  assert.equal(shouldShow(completed, clip), false);
  assert.equal(recordOpen(completed), completed);
  assert.equal(shouldShow(parseProgress(JSON.stringify(completed)), clip), false);
});
test('visibility alone never completes the tutorial, including old saved seen flags', () => {
  for (const raw of [null, 'invalid', '[]', '{"seen":true}', '{"opened":"true"}'])
    assert.deepEqual(parseProgress(raw), FRESH);
  assert.deepEqual(parseProgress('{"opens":1}'), { opened: true });
});
test('force bypasses completion but never a game, covering surface or missing tells', () => {
  const completed = recordOpen(FRESH);
  assert.equal(shouldShow(completed, clip, 'doubleTake'), true);
  for (const force of ['off', 'doubleTake'] as const) {
    assert.equal(shouldShow(FRESH, { ...clip, blocked: true }, force), false);
    assert.equal(shouldShow(FRESH, { ...clip, hasTells: false }, force), false);
  }
});
test('default delay is brief and offered in tutorial settings', () => {
  assert.equal(SHOW_DELAY_MS, 1000);
  assert.ok(HINT_DELAYS.includes(SHOW_DELAY_MS));
});

test('Both is one hint with one caption: hold or double tap', () => {
  assert.equal(demoCaption('both', { mouse: false }), 'Hold or double tap');
  assert.equal(demoCaption('both', { mouse: true }), 'Hold or double-tap Space');
});

test('a single gesture gets a word or two, worded for the input', () => {
  assert.equal(demoCaption('hold', { mouse: false }), 'Hold');
  assert.equal(demoCaption('hold', { mouse: true }), 'Hold Space');
  assert.equal(demoCaption('doubleTap', { mouse: false }), 'Double tap');
  assert.equal(demoCaption('doubleTap', { mouse: true }), 'Double-tap Space');
});
