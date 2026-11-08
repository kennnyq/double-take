import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_GESTURES } from './settings.ts';
import {
  DOUBLE_TAP_MS,
  createTapRecognizer,
  gestureAction,
  gestureOptions,
  isDoubleTap,
  revealHow,
  revealsWith,
  singleTapWaits,
  spaceWaitsForHold,
  type Timers,
} from './gesture.ts';

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

/** Timers driven by hand: `advance(ms)` runs whatever falls due. */
function fakeTimers(): Timers & { advance: (ms: number) => void; pending: () => number } {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn, ms) => {
      due.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void due.delete(h as number),
    advance(ms) {
      now += ms;
      for (const [k, v] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (v.at <= now) {
          due.delete(k);
          v.fn();
        }
      }
    },
    pending: () => due.size,
  };
}

function recorder(wait: boolean) {
  const log: string[] = [];
  return { log, h: { wait, onSingle: () => log.push('single'), onDouble: (ran: boolean) => log.push(`double(firstRan=${ran})`) } };
}

test('one shared double-tap window of about 250 ms', () => {
  assert.equal(DOUBLE_TAP_MS, 250);
});

test('the single tap waits only when a double tap opens this clip’s double take', () => {
  assert.equal(singleTapWaits('doubleTap', true), true);
  assert.equal(singleTapWaits('both', true), true);
  assert.equal(singleTapWaits('hold', true), false, 'Hold only: taps stay instant');
  assert.equal(singleTapWaits('both', false), false, 'no tells: double tap likes, taps stay instant');
});

test('waiting: a lone tap pauses/plays once the window passes', () => {
  const t = fakeTimers();
  const r = createTapRecognizer(t);
  const { log, h } = recorder(true);
  r.tap({ t: 0, x: 10, y: 10 }, h);
  t.advance(DOUBLE_TAP_MS - 1);
  assert.deepEqual(log, [], 'not yet');
  t.advance(1);
  assert.deepEqual(log, ['single']);
});

test('waiting: a second tap cancels the pause and only the double tap acts', () => {
  const t = fakeTimers();
  const r = createTapRecognizer(t);
  const { log, h } = recorder(true);
  r.tap({ t: 0, x: 10, y: 10 }, h);
  t.advance(120);
  r.tap({ t: 120, x: 12, y: 9 }, h);
  t.advance(1000);
  assert.deepEqual(log, ['double(firstRan=false)'], 'no stray pause or resume');
  assert.equal(t.pending(), 0);
});

test('not waiting (Hold mode): the tap acts at once and a double tap follows it', () => {
  const t = fakeTimers();
  const r = createTapRecognizer(t);
  const { log, h } = recorder(false);
  r.tap({ t: 0, x: 10, y: 10 }, h);
  assert.deepEqual(log, ['single'], 'instant');
  r.tap({ t: 100, x: 10, y: 10 }, h);
  assert.deepEqual(log, ['single', 'double(firstRan=true)']);
});

test('a third tap starts over, and slow taps are two singles', () => {
  const t = fakeTimers();
  const r = createTapRecognizer(t);
  const { log, h } = recorder(true);
  r.tap({ t: 0, x: 0, y: 0 }, h);
  r.tap({ t: 100, x: 0, y: 0 }, h); // double
  r.tap({ t: 200, x: 0, y: 0 }, h); // a new first tap
  t.advance(1000);
  r.tap({ t: 2000, x: 0, y: 0 }, h);
  t.advance(1000);
  assert.deepEqual(log, ['double(firstRan=false)', 'single', 'single']);
});

test('cancel drops a waiting tap, e.g. when the clip scrolls away or a hold starts', () => {
  const t = fakeTimers();
  const r = createTapRecognizer(t);
  const { log, h } = recorder(true);
  r.tap({ t: 0, x: 0, y: 0 }, h);
  r.cancel();
  t.advance(1000);
  r.tap({ t: 100, x: 0, y: 0 }, h); // not a double: the first was forgotten
  t.advance(1000);
  assert.deepEqual(log, ['single']);
});
