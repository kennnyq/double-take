import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH,
  HINT_TIMEOUT_MS,
  LOOPS,
  MAX_TRIES_PER_SESSION,
  STEP_MS,
  NEW_SESSION,
  OPENS_TO_LEARN,
  demoCaption,
  demoSteps,
  endHint,
  hintTimeout,
  loopMs,
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

test('the demo follows the gesture setting', () => {
  assert.deepEqual(demoSteps('hold'), ['hold']);
  assert.deepEqual(demoSteps('doubleTap'), ['doubleTap']);
  // Both walks through the two in turn: hold (Space), then double tap (double-click).
  assert.deepEqual(demoSteps('both'), ['hold', 'doubleTap']);
});

test('a hint plays its whole walk-through twice before it goes', () => {
  const both = demoSteps('both');
  assert.equal(loopMs(both), STEP_MS.hold + STEP_MS.doubleTap);
  assert.equal(hintTimeout(both), LOOPS * loopMs(both));
  assert.ok(hintTimeout(['doubleTap']) >= HINT_TIMEOUT_MS, 'never shorter than the floor');
  for (const st of Object.values(STEP_MS)) assert.ok(st <= 3000, 'each step stays short');
});

test('captions are a word or two, worded for the input', () => {
  const touch = { mouse: false, spaceKey: false };
  assert.equal(demoCaption('doubleTap', touch), 'Double tap');
  assert.equal(demoCaption('hold', touch), 'Hold');
  assert.equal(demoCaption('doubleTap', { mouse: true, spaceKey: true }), 'Double-click');
  assert.equal(demoCaption('hold', { mouse: true, spaceKey: true }), 'Hold Space');
  // A mouse on the phone layout has no Space key to hold.
  assert.equal(demoCaption('hold', { mouse: true, spaceKey: false }), 'Hold');
  // A touch screen on the desktop layout holds the clip, not a key.
  assert.equal(demoCaption('hold', { mouse: false, spaceKey: true }), 'Hold');
});
