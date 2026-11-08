import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH,
  MAX_TRIES_PER_SESSION,
  NEW_SESSION,
  OPENS_TO_LEARN,
  demoCaption,
  demoSteps,
  endHint,
  enterClip,
  hintFor,
  parseProgress,
  recordOpen,
  startHint,
  type ClipContext,
  type HintProgress,
  type HintSession,
} from './hints.ts';

const phone = (clipId: string, over: Partial<ClipContext> = {}): ClipContext => ({
  clipId,
  hasTells: true,
  blocked: false,
  canSwipe: true,
  ...over,
});
const learnedSwipe: HintProgress = { opens: 0, swiped: true };

test('a brand-new viewer gets the swipe hint first, on the first clip only', () => {
  const { session } = enterClip(NEW_SESSION, 'a');
  assert.equal(hintFor(FRESH, session, phone('a')), 'swipe');
  // Never the double take hint at the same time: the swipe one wins until it's learned.
  assert.notEqual(hintFor(FRESH, session, phone('a')), 'doubleTake');
});

test('moving to another clip counts as a swipe; the double take hint follows', () => {
  let { session } = enterClip(NEW_SESSION, 'a');
  const moved = enterClip(session, 'b');
  assert.equal(moved.swiped, true);
  session = moved.session;
  assert.equal(enterClip(session, 'a').swiped, false, 'back on the first clip');
  assert.equal(hintFor(learnedSwipe, session, phone('b')), 'doubleTake');
});

test('the swipe hint seen through never comes back; cut short, it does', () => {
  const s = enterClip(NEW_SESSION, 'a').session;
  assert.equal(endHint(FRESH, s, 'swipe', 'timeout').progress.swiped, true);
  assert.equal(endHint(FRESH, s, 'swipe', 'left').progress.swiped, false);
});

test('desktop has no swipe hint and goes straight to the double take', () => {
  const s = enterClip(NEW_SESSION, 'a').session;
  assert.equal(hintFor(FRESH, s, phone('a', { canSwipe: false })), 'doubleTake');
});

test('no double take hint on clips without tells, or while blocked', () => {
  const s = enterClip(NEW_SESSION, 'a').session;
  assert.equal(hintFor(learnedSwipe, s, phone('a', { hasTells: false })), null);
  assert.equal(hintFor(learnedSwipe, s, phone('a', { blocked: true })), null);
  assert.equal(hintFor(FRESH, s, phone('a', { blocked: true })), null, 'not the swipe hint either');
});

test('opening a double take ends the hint for the session', () => {
  let session: HintSession = startHint(enterClip(NEW_SESSION, 'a').session, 'doubleTake');
  ({ session } = endHint(learnedSwipe, session, 'doubleTake', 'gesture'));
  assert.equal(hintFor(learnedSwipe, session, phone('b')), null);
});

test('a hint that times out is done for the session but back next session', () => {
  let session: HintSession = startHint(NEW_SESSION, 'doubleTake');
  ({ session } = endHint(learnedSwipe, session, 'doubleTake', 'timeout'));
  assert.equal(hintFor(learnedSwipe, session, phone('c')), null);
  assert.equal(hintFor(learnedSwipe, { ...NEW_SESSION }, phone('c')), 'doubleTake', 'a new session');
});

test('a hint cut short tries again on a later clip, a few times a session', () => {
  let session: HintSession = { ...NEW_SESSION, firstClip: 'a' };
  for (let i = 0; i < MAX_TRIES_PER_SESSION; i++) {
    assert.equal(hintFor(learnedSwipe, session, phone(`c${i}`)), 'doubleTake');
    session = startHint(session, 'doubleTake');
    ({ session } = endHint(learnedSwipe, session, 'doubleTake', 'left'));
  }
  assert.equal(hintFor(learnedSwipe, session, phone('z')), null);
});

test('after OPENS_TO_LEARN double takes the hint never shows again', () => {
  let p: HintProgress = learnedSwipe;
  for (let i = 0; i < OPENS_TO_LEARN; i++) {
    assert.equal(hintFor(p, { ...NEW_SESSION }, phone('a')), 'doubleTake');
    p = recordOpen(p);
  }
  assert.equal(p.opens, OPENS_TO_LEARN);
  assert.equal(hintFor(p, { ...NEW_SESSION }, phone('a')), null);
  assert.equal(recordOpen(p), p, 'stops counting');
});

test('the dev override shows a hint on every clip, whatever the progress', () => {
  const learned: HintProgress = { opens: OPENS_TO_LEARN, swiped: true };
  const done: HintSession = { done: true, tries: 99, firstClip: 'a' };
  assert.equal(hintFor(learned, done, phone('q'), 'doubleTake'), 'doubleTake');
  assert.equal(hintFor(learned, done, phone('q', { hasTells: false }), 'doubleTake'), null);
  assert.equal(hintFor(learned, done, phone('q'), 'swipe'), 'swipe');
  assert.equal(hintFor(learned, done, phone('q', { canSwipe: false }), 'swipe'), null);
  assert.equal(hintFor(learned, done, phone('q', { blocked: true }), 'doubleTake'), null, 'still never over a double take');
});

test('stored progress parses defensively', () => {
  assert.deepEqual(parseProgress(null), FRESH);
  assert.deepEqual(parseProgress('not json'), FRESH);
  assert.deepEqual(parseProgress('[1]'), FRESH);
  assert.deepEqual(parseProgress('{"opens":1,"swiped":true}'), { opens: 1, swiped: true });
  assert.deepEqual(parseProgress('{"opens":99,"swiped":"yes"}'), { opens: OPENS_TO_LEARN, swiped: false });
  assert.deepEqual(parseProgress('{"opens":-3.5}'), { opens: 0, swiped: false });
});

test('the demo follows the gesture setting', () => {
  assert.deepEqual(demoSteps('hold'), ['hold']);
  assert.deepEqual(demoSteps('doubleTap'), ['doubleTap']);
  assert.deepEqual(demoSteps('both'), ['doubleTap', 'hold']);
});

test('captions are a word or two, worded for the input', () => {
  const touch = { mouse: false, spaceKey: false };
  assert.equal(demoCaption('doubleTap', touch), 'Double tap');
  assert.equal(demoCaption('hold', touch), 'Hold');
  assert.equal(demoCaption('swipe', touch), 'Swipe up');
  assert.equal(demoCaption('doubleTap', { mouse: true, spaceKey: true }), 'Double-click');
  assert.equal(demoCaption('hold', { mouse: true, spaceKey: true }), 'Hold Space');
  // A mouse on the phone layout has no Space key to hold.
  assert.equal(demoCaption('hold', { mouse: true, spaceKey: false }), 'Hold');
  // A touch screen on the desktop layout holds the clip, not a key.
  assert.equal(demoCaption('hold', { mouse: false, spaceKey: true }), 'Hold');
});
