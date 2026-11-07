import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOX_HALF_SPAN, MIN_WINDOW, fitToShot, mentionsTime, normalizeWindow, parseTime, shotAround } from './timing.ts';

test('parseTime reads the ways notes and models write times', () => {
  const cases: [unknown, number | null][] = [
    [7, 7],
    [0, 0],
    ['7', 7],
    ['7s', 7],
    ['~2s', 2],
    ['0:07', 7],
    ['00:07.5', 7.5],
    ['1:02', 62],
    ['1:02:03', 3723],
    ['around 2 seconds', 2],
    [-1, null],
    [NaN, null],
    [Infinity, null],
    [null, null],
    [undefined, null],
    ['soon', null],
    [{}, null],
  ];
  for (const [input, want] of cases) assert.equal(parseTime(input), want, JSON.stringify(input));
});

test('mentionsTime spots real timestamps only', () => {
  assert.ok(mentionsTime('At 0:07: the Dresser disappears'));
  assert.ok(mentionsTime('a fingernail at ~7 seconds'));
  assert.ok(mentionsTime('morphs into a leg around 2 seconds in'));
  assert.ok(mentionsTime('look at 3s'));
  assert.ok(!mentionsTime('The 10 second length is a sign of Sora'));
  assert.ok(!mentionsTime('evident by the 10s long runtime'));
  assert.ok(!mentionsTime('This video is AI generated.'));
});

test('a zero-length window (real PoC output: start_s = end_s = 7) is widened to be visible', () => {
  const w = normalizeWindow({ t0: 7, t1: 7, hasBox: false, duration: 15 })!;
  assert.equal(w.t1 - w.t0, MIN_WINDOW);
  assert.ok(w.focusT >= w.t0 && w.focusT <= w.t1);
  assert.match(w.notes.join(), /widened/);
});

test('boxed tells stay near the frame they were drawn on', () => {
  const w = normalizeWindow({ t0: 0, t1: 9.4, frameT: 5.5, hasBox: true, duration: 9.4 })!;
  assert.ok(w.t1 - w.t0 <= 2 * BOX_HALF_SPAN + 1e-9);
  assert.equal(w.focusT, 5.5);
  assert.match(w.notes.join(), /most of the clip/);
});

test('a box frame outside the claimed window wins, with a note', () => {
  const w = normalizeWindow({ t0: 7, t1: 7.5, frameT: 5.5, hasBox: true, duration: 15 })!;
  assert.equal(w.focusT, 5.5);
  assert.ok(w.t0 <= 5.5 && w.t1 >= 5.5);
  assert.match(w.notes.join(), /outside the claimed/);
});

test('the claimed window is kept where it overlaps the frame', () => {
  const w = normalizeWindow({ t0: 6, t1: 6.5, frameT: 6, hasBox: true, duration: 15 })!;
  assert.ok(w.t0 <= 6 && w.t1 >= 6.5);
  assert.ok(w.t1 - w.t0 >= MIN_WINDOW);
});

test('times are clamped to the clip and swapped when reversed', () => {
  const w = normalizeWindow({ t0: 9, t1: 8, hasBox: false, duration: 10 })!;
  assert.ok(w.t0 >= 0 && w.t1 <= 10 && w.t1 > w.t0);
  assert.match(w.notes.join(), /swapped/);
  const end = normalizeWindow({ t0: 9.8, t1: 12, hasBox: false, duration: 10 })!;
  assert.equal(end.t1, 10);
  assert.ok(end.t1 - end.t0 >= MIN_WINDOW - 1e-9);
});

test('unusable times return null instead of a guess', () => {
  assert.equal(normalizeWindow({ t0: null, t1: null, hasBox: false, duration: 10 }), null);
  assert.equal(normalizeWindow({ t0: 0, t1: 10, hasBox: false, duration: 10 }), null); // whole clip, no frame
  assert.equal(normalizeWindow({ t0: 12, t1: 13, hasBox: false, duration: 10 }), null); // past the end
  assert.equal(normalizeWindow({ t0: 1, t1: 2, hasBox: false, duration: 0 }), null);
  // Past the end but a frame exists: follow the frame.
  const f = normalizeWindow({ t0: 12, t1: 13, frameT: 4, hasBox: true, duration: 10 })!;
  assert.equal(f.focusT, 4);
});

test('short clips: window never exceeds the clip', () => {
  const w = normalizeWindow({ t0: 0.2, t1: 0.2, hasBox: false, duration: 0.8 })!;
  assert.equal(w.t0, 0);
  assert.equal(w.t1, 0.8);
});

test('a claimed window the box frame contradicts is ignored, not intersected (real Super VL reply: frame 5.5s, t0–t1 0–4s)', () => {
  const w = normalizeWindow({ t0: 0, t1: 4, frameT: 5.5, hasBox: true, duration: 15 })!;
  assert.deepEqual([w.t0, w.t1, w.focusT], [4.5, 6.5, 5.5]);
});

test('a before/after moment is kept inside the window', () => {
  const w = normalizeWindow({ t0: 7, t1: 7, frameT: 5.5, compareT: 7.5, hasBox: true, duration: 15 })!;
  assert.equal(w.focusT, 5.5);
  assert.ok(w.t0 <= 5.5 && w.t1 >= 7.5 + 0.3 - 1e-9);
  const before = normalizeWindow({ t0: null, t1: null, frameT: 3, compareT: 1, hasBox: true, duration: 4 })!;
  assert.ok(before.t0 <= 0.7 + 1e-9);
});

test('tells stay inside their shot (cuts from the Spy x Family fight clip)', () => {
  const cuts = [2.5, 2.6, 2.93, 3.43, 3.6, 5.27, 7.3, 10.03];
  assert.deepEqual(shotAround(cuts, 2.55, 10.19), { t0: 2.5, t1: 2.6 });
  assert.deepEqual(shotAround(cuts, 1, 10.19), { t0: 0, t1: 2.5 });
  assert.deepEqual(shotAround(cuts, 10.1, 10.19), { t0: 10.03, t1: 10.19 });

  const { tell, note } = fitToShot({ t0: 1.5, t1: 4, focusT: 2.55, compareT: 3.2 }, cuts, 10.19);
  assert.deepEqual(tell, { t0: 2.5, t1: 2.6, focusT: 2.55, shot: { t0: 2.5, t1: 2.6 } });
  assert.match(note!, /another shot/);
  assert.match(note!, /trimmed/);

  // Before/after inside one shot survives; a clip with no cuts is untouched.
  const same = fitToShot<{ t0: number; t1: number; focusT?: number; compareT?: number; shot?: { t0: number; t1: number } }>({ t0: 5.5, t1: 7, focusT: 6, compareT: 6.5 }, cuts, 10.19);
  assert.equal(same.tell.compareT, 6.5);
  assert.deepEqual(same.tell.shot, { t0: 5.27, t1: 7.3 });
  const none = { t0: 5.5, t1: 7, focusT: 6, compareT: 6.5 };
  assert.equal(fitToShot(none, [], 10).tell, none);
});
