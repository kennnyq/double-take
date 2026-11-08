import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVEAL_TOTAL_MS,
  REVEAL_UNIT_MS,
  dropSpring,
  easeIn,
  revealFrame,
  revealLetters,
  revealMetrics,
  revealSchedule,
  revealWords,
  unitDelays,
  unitStep,
} from './reveal.ts';

test('units start one after another so the whole text takes Apple’s 0.9 s', () => {
  // Apple's demo: 14 glyphs of "Visual Effects", ~36 ms apart (one video frame).
  assert.ok(Math.abs(unitStep(14) - 35.7) < 0.1);
  const words = revealWords('Real highway signs use real words; AI video still struggles to render text.');
  assert.equal(words.length, 13);
  const d = unitDelays(words.length);
  assert.equal(d[0], 0);
  assert.ok(d[1] > 20 && d[1] < 50);
  for (const n of [1, 2, 3, 13, 40, 120]) {
    const { hint, total } = revealSchedule(n);
    assert.ok(total <= REVEAL_TOTAL_MS + 1e-9, `${n} units: ${total}`);
    assert.equal(total, hint + REVEAL_UNIT_MS);
  }
  assert.deepEqual(unitDelays(0), []);
});

test('easeIn is CSS / SwiftUI ease-in: slow start, 0..1', () => {
  assert.equal(easeIn(0), 0);
  assert.equal(easeIn(1), 1);
  assert.ok(Math.abs(easeIn(0.5) - 0.315) < 0.01, `${easeIn(0.5)}`);
  assert.ok(easeIn(0.2) < 0.1);
});

test('the drop overshoots its place a little and is exactly home by the end of the unit', () => {
  assert.equal(dropSpring(0), 1);
  let min = 1;
  for (let t = 0; t <= REVEAL_UNIT_MS; t += 5) min = Math.min(min, dropSpring(t));
  // Measured in Apple's demo: ~24 % past its place.
  assert.ok(min < -0.18 && min > -0.3, `${min}`);
  assert.equal(dropSpring(REVEAL_UNIT_MS), 0);
  assert.ok(Math.abs(dropSpring(REVEAL_UNIT_MS - 5)) < 0.05);
});

test('revealFrame: from invisible, a descent above and slightly blurred, to settled and sharp', () => {
  const m = revealMetrics({ fontSize: 15, lineHeight: 20 });
  assert.ok(Math.abs(m.descent - 3.6) < 0.01);
  assert.equal(m.blur, 1.25);
  const start = revealFrame(100, 100, m);
  assert.equal(start.opacity, 0);
  assert.ok(Math.abs(start.translateY + m.descent) < 1e-9, 'starts just above its place');
  assert.equal(start.blur, m.blur);
  // Opacity is in by ~0.29 s (1 / 1.4 of the unit).
  assert.equal(revealFrame(100 + REVEAL_UNIT_MS / 1.4 + 1, 100, m).opacity, 1);
  const end = revealFrame(2000, 0, m);
  assert.deepEqual(end, { opacity: 1, translateY: -0, blur: 0 });
});

test('letters keep emoji whole', () => {
  assert.deepEqual(revealLetters('Hi!'), ['H', 'i', '!']);
  assert.equal(revealLetters('ok👍🏽').length, 3);
});
