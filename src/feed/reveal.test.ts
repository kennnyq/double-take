import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_LINE_DURATION, REVEAL_LINE_MS, lineDelays, lineProgress, revealTimes, wipeEdge } from './reveal.ts';

test('lines start one after another from the top; the hint follows the last', () => {
  assert.deepEqual(lineDelays(3), [0, REVEAL_LINE_MS, 2 * REVEAL_LINE_MS]);
  assert.deepEqual(lineDelays(0), []);
  const { hint, total } = revealTimes(3);
  assert.ok(hint > 2 * REVEAL_LINE_MS);
  assert.equal(total, hint + REVEAL_LINE_DURATION);
});

test('lineProgress eases from 0 to 1 over a line’s duration', () => {
  assert.equal(lineProgress(0, 50), 0);
  assert.equal(lineProgress(50 + REVEAL_LINE_DURATION, 50), 1);
  const mid = lineProgress(50 + REVEAL_LINE_DURATION / 2, 50);
  assert.ok(mid > 0.5 && mid < 1, `${mid}`); // ease out: past half at half time
});

test('wipeEdge sweeps from above the block to past it', () => {
  assert.ok(wipeEdge(0, 500) < 0);
  assert.ok(wipeEdge(500, 500) > 100);
  assert.ok(wipeEdge(250, 500) > wipeEdge(100, 500));
});

test('word wave: quick reading-order stagger; a short sentence finishes well under a second', async () => {
  const { REVEAL_STYLES, revealSchedule, revealWords, unitDelays } = await import('./reveal.ts');
  const words = revealWords('Real highway signs use real words; AI video still struggles to render text.');
  assert.equal(words.length, 13);
  const d = unitDelays(words.length, 'wave');
  assert.equal(d[0], 0);
  assert.equal(d[1], REVEAL_STYLES.wave.stagger);
  assert.ok(REVEAL_STYLES.wave.stagger >= 20 && REVEAL_STYLES.wave.stagger <= 40);
  assert.ok(revealSchedule(words.length, 'wave').total < 1000);
  assert.ok(revealSchedule(words.length, 'soft').total > revealSchedule(words.length, 'wave').total);
});

test('springProgress: no overshoot, ~settled at its settle time', async () => {
  const { springProgress } = await import('./reveal.ts');
  let prev = 0;
  for (let t = 0; t <= 800; t += 10) {
    const p = springProgress(t, 420);
    assert.ok(p >= prev - 1e-12 && p <= 1, `monotonic and never past 1 at ${t}`);
    prev = p;
  }
  assert.ok(springProgress(420, 420) > 0.97);
  assert.equal(springProgress(-5, 420), 0);
});

test('revealFrame: from faint, off its place, small and blurred to settled', async () => {
  const { REVEAL_STYLES, revealFrame } = await import('./reveal.ts');
  const s = REVEAL_STYLES.wave;
  const start = revealFrame(0, 0, s);
  assert.deepEqual(start, { opacity: 0, translateY: s.offset, scale: s.scale, blur: s.blur });
  assert.ok(s.offset < 0, 'the wave drops into place from just above, as in Apple\u2019s demo');
  const end = revealFrame(2000, 0, s);
  assert.ok(end.opacity > 0.999 && Math.abs(end.translateY) < 0.01 && end.scale > 0.999 && end.blur < 0.01);
  // Without a blur the fade trails the motion; with one it leads, as Apple's does.
  const noBlur = revealFrame(80, 0, s, false);
  const withBlur = revealFrame(80, 0, s, true);
  assert.ok(noBlur.opacity < 1 - noBlur.translateY / s.offset);
  assert.ok(withBlur.opacity > noBlur.opacity);
});

test('a long text staggers faster, so the whole reveal stays about as long as Apple\u2019s', async () => {
  const { REVEAL_STYLES, revealSchedule, unitStep } = await import('./reveal.ts');
  assert.equal(unitStep(5, 'wave'), REVEAL_STYLES.wave.stagger);
  assert.ok(unitStep(40, 'wave') < REVEAL_STYLES.wave.stagger);
  assert.ok(revealSchedule(40, 'wave').total <= REVEAL_STYLES.wave.spread + 40 + REVEAL_STYLES.wave.settle + 1);
  assert.ok(revealSchedule(40, 'wave').total < 1000);
});
