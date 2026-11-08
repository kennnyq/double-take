import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH, DEMO_MS, HINT_TIMEOUT_MS, LOOPS, MIN_VISIBLE_MS, NEW_SESSION,
  demoCaption, endHint, hintTimeout, parseProgress, recordSeen, shouldShow,
  type ClipContext,
} from './hints.ts';

const clip = (over: Partial<ClipContext> = {}): ClipContext => ({ hasTells: true, blocked: false, ...over });
const seen = { seen: true };

test('new visitors and signed-in users who have not seen the prompt get it', () => {
  assert.equal(shouldShow(FRESH, NEW_SESSION, clip()), true);
  assert.equal(shouldShow(FRESH, NEW_SESSION, clip(), 'off', true), true);
});

test('signed-out visitors see it on every refresh even if previously seen', () => {
  assert.equal(shouldShow(seen, NEW_SESSION, clip()), true);
  assert.equal(shouldShow(seen, NEW_SESSION, clip(), 'off', true), false);
});

test('only half a second of continuous visibility counts as seen', () => {
  assert.equal(recordSeen(FRESH, MIN_VISIBLE_MS - 1), FRESH);
  assert.deepEqual(recordSeen(FRESH, MIN_VISIBLE_MS), seen);
  assert.deepEqual(recordSeen(FRESH, MIN_VISIBLE_MS + 1), seen);
  assert.equal(recordSeen(seen, MIN_VISIBLE_MS), seen);
});

test('quick scrolling can retry indefinitely, until a prompt has actually been seen', () => {
  let session = { ...NEW_SESSION };
  for (let i = 0; i < 20; i++) {
    assert.equal(shouldShow(FRESH, session, clip()), true);
    session = endHint(session, 'left');
  }
  session = { ...session, seen: true };
  assert.equal(shouldShow(seen, endHint(session, 'left'), clip()), false);
});

test('opening a double take or timing out ends the hint for this visit only', () => {
  for (const why of ['gesture', 'timeout'] as const) {
    assert.equal(shouldShow(FRESH, endHint(NEW_SESSION, why), clip()), false);
    assert.equal(shouldShow(FRESH, NEW_SESSION, clip()), true);
  }
});

test('no hint under a covering surface or without tells, even with the dev override', () => {
  for (const force of ['off', 'doubleTake'] as const) {
    assert.equal(shouldShow(FRESH, NEW_SESSION, clip({ hasTells: false }), force), false);
    assert.equal(shouldShow(FRESH, NEW_SESSION, clip({ blocked: true }), force), false);
  }
  assert.equal(shouldShow(seen, { done: true, seen: true }, clip(), 'doubleTake', true), true);
});

test('only an explicit seen flag survives storage; legacy open counts do not hide the prompt', () => {
  for (const raw of [null, 'not json', '[1]', '{"opens":99}', '{"seen":"true"}']) {
    assert.deepEqual(parseProgress(raw), FRESH);
  }
  assert.deepEqual(parseProgress('{"seen":true}'), seen);
});

test('a hint plays its demo twice before it goes, and each demo stays short', () => {
  for (const demo of ['hold', 'doubleTap', 'both'] as const) {
    assert.equal(hintTimeout(demo), Math.max(HINT_TIMEOUT_MS, LOOPS * DEMO_MS[demo]));
    assert.ok(DEMO_MS[demo] <= 4000, demo);
  }
});

test('Both is one hint with one caption: hold or double tap', () => {
  assert.equal(demoCaption('both', { mouse: false }), 'Hold or double tap');
  assert.equal(demoCaption('both', { mouse: true }), 'Hold spacebar or double click');
});

test('a single gesture gets a word or two, worded for the input', () => {
  assert.equal(demoCaption('hold', { mouse: false }), 'Hold');
  assert.equal(demoCaption('hold', { mouse: true }), 'Hold spacebar');
  assert.equal(demoCaption('doubleTap', { mouse: false }), 'Double tap');
  assert.equal(demoCaption('doubleTap', { mouse: true }), 'Double click');
});
