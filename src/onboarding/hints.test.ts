import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH,
  DEMO_MS,
  HINT_TIMEOUT_MS,
  LOOPS,
  MAX_TRIES_PER_SESSION,
  NEW_SESSION,
  OPENS_TO_LEARN,
  demoCaption,
  endHint,
  hintTimeout,
  parseProgress,
  recordOpen,
  shouldShow,
  startHint,
  type ClipContext,
  type HintProgress,
  type HintSession,
} from './hints.ts';

const clip = (over: Partial<ClipContext> = {}): ClipContext => ({ hasTells: true, blocked: false, ...over });

test('a brand-new viewer gets the gesture hint straight away: there is no swipe hint', () => {
  assert.equal(shouldShow(FRESH, NEW_SESSION, clip()), true);
});

test('no hint on clips without tells, or while blocked', () => {
  assert.equal(shouldShow(FRESH, NEW_SESSION, clip({ hasTells: false })), false);
  assert.equal(shouldShow(FRESH, NEW_SESSION, clip({ blocked: true })), false);
});

test('opening a double take ends the hint for the session', () => {
  const session = endHint(startHint(NEW_SESSION), 'gesture');
  assert.equal(shouldShow(FRESH, session, clip()), false);
});

test('a hint that times out is done for the session but back next session', () => {
  const session = endHint(startHint(NEW_SESSION), 'timeout');
  assert.equal(shouldShow(FRESH, session, clip()), false);
  assert.equal(shouldShow(FRESH, { ...NEW_SESSION }, clip()), true, 'a new session');
});

test('a hint cut short tries again on a later clip, a few times a session', () => {
  let session: HintSession = { ...NEW_SESSION };
  for (let i = 0; i < MAX_TRIES_PER_SESSION; i++) {
    assert.equal(shouldShow(FRESH, session, clip()), true);
    session = endHint(startHint(session), 'left');
  }
  assert.equal(shouldShow(FRESH, session, clip()), false);
});

test('after OPENS_TO_LEARN double takes the hint never shows again', () => {
  let p: HintProgress = FRESH;
  for (let i = 0; i < OPENS_TO_LEARN; i++) {
    assert.equal(shouldShow(p, { ...NEW_SESSION }, clip()), true);
    p = recordOpen(p);
  }
  assert.equal(p.opens, OPENS_TO_LEARN);
  assert.equal(shouldShow(p, { ...NEW_SESSION }, clip()), false);
  assert.equal(recordOpen(p), p, 'stops counting');
});

test('the dev override shows it on every clip with tells, whatever the progress', () => {
  const learned: HintProgress = { opens: OPENS_TO_LEARN };
  const done: HintSession = { done: true, tries: 99 };
  assert.equal(shouldShow(learned, done, clip(), 'doubleTake'), true);
  assert.equal(shouldShow(learned, done, clip({ hasTells: false }), 'doubleTake'), false);
  assert.equal(shouldShow(learned, done, clip({ blocked: true }), 'doubleTake'), false, 'still never over a double take');
});

test('stored progress parses defensively, and older saves with a swipe flag still load', () => {
  assert.deepEqual(parseProgress(null), FRESH);
  assert.deepEqual(parseProgress('not json'), FRESH);
  assert.deepEqual(parseProgress('[1]'), FRESH);
  assert.deepEqual(parseProgress('{"opens":1,"swiped":true}'), { opens: 1 });
  assert.deepEqual(parseProgress('{"opens":99}'), { opens: OPENS_TO_LEARN });
  assert.deepEqual(parseProgress('{"opens":-3.5}'), { opens: 0 });
});

test('a hint plays its demo twice before it goes, and each demo stays short', () => {
  for (const demo of ['hold', 'doubleTap', 'both'] as const) {
    assert.equal(hintTimeout(demo), Math.max(HINT_TIMEOUT_MS, LOOPS * DEMO_MS[demo]));
    assert.ok(DEMO_MS[demo] <= 4000, demo);
  }
});

test('Both is one hint with one caption: hold or double tap', () => {
  assert.equal(demoCaption('both', { mouse: false }), 'Hold or double tap');
  assert.equal(demoCaption('both', { mouse: true }), 'Hold or double-click');
});

test('a single gesture gets a word or two, worded for the input', () => {
  assert.equal(demoCaption('hold', { mouse: false }), 'Hold');
  assert.equal(demoCaption('hold', { mouse: true }), 'Hold');
  assert.equal(demoCaption('doubleTap', { mouse: false }), 'Double tap');
  assert.equal(demoCaption('doubleTap', { mouse: true }), 'Double-click');
});
