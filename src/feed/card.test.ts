import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSpot, emptierSide, estimateCardHeight } from './card.ts';

const STAGE = { stageW: 430, stageH: 860, safeTop: 100, safeBottom: 24, cardH: 110 };

test('cardSpot: without an area, the card goes to the asked side', () => {
  const top = cardSpot({ ...STAGE, hole: null, placement: 'top' });
  assert.deepEqual(top, { side: 'top', offset: 100, cx: 215, width: 320 });
  const bottom = cardSpot({ ...STAGE, hole: null, placement: 'bottom' });
  assert.equal(bottom.side, 'bottom');
  assert.equal(bottom.offset, 24);
});

test('cardSpot: just below the area when it fits, centred on it within the stage', () => {
  const s = cardSpot({ ...STAGE, hole: { x: 300, y: 200, w: 100, h: 80 }, placement: 'top' });
  assert.equal(s.side, 'top');
  assert.equal(s.offset, 292);
  // Centred on 350 would run off the right edge: pulled in.
  assert.equal(s.cx, 430 - 12 - 160);
});

test('cardSpot: above the area when there is no room below', () => {
  const s = cardSpot({ ...STAGE, hole: { x: 100, y: 650, w: 100, h: 150 }, placement: 'bottom' });
  assert.equal(s.side, 'bottom');
  assert.equal(s.offset, 860 - 650 + 12);
});

test('cardSpot: both fit, the tell placement decides unless below is much roomier', () => {
  const hole = { x: 100, y: 380, w: 100, h: 60 };
  assert.equal(cardSpot({ ...STAGE, hole, placement: 'bottom' }).side, 'top'); // below the area
  assert.equal(cardSpot({ ...STAGE, hole, placement: 'top' }).side, 'bottom'); // above the area
});

test('cardSpot: a huge area keeps the card on stage', () => {
  const s = cardSpot({ ...STAGE, hole: { x: 0, y: 120, w: 430, h: 720 }, placement: 'top' });
  if (s.side === 'top') assert.ok(s.offset + STAGE.cardH <= STAGE.stageH - STAGE.safeBottom);
  else assert.ok(s.offset + STAGE.cardH <= STAGE.stageH - STAGE.safeTop);
});

test('estimateCardHeight grows with the text', () => {
  const short = estimateCardHeight('Hand melts', 320);
  const long = estimateCardHeight('The fingers on her left hand merge into one another as she lifts the cup, then split apart again.', 320);
  assert.ok(long > short);
  assert.equal(estimateCardHeight('x', 320, false), short - 20);
});

test('emptierSide: letterboxed clips use the bigger band', () => {
  // 16:9 clip in a 430×860 stage, nudged up.
  assert.equal(emptierSide({ x: 0, y: 280, w: 430, h: 242 }, 860, []), 'bottom');
  assert.equal(emptierSide({ x: 0, y: 340, w: 430, h: 242 }, 860, []), 'top');
});

test('emptierSide: full-frame clips avoid the other tells, else the top', () => {
  const frame = { x: 0, y: -20, w: 430, h: 900 };
  assert.equal(emptierSide(frame, 860, [{ x: 10, y: 600, w: 50, h: 50 }]), 'top');
  assert.equal(emptierSide(frame, 860, [{ x: 10, y: 100, w: 50, h: 50 }]), 'bottom');
  assert.equal(emptierSide(frame, 860, []), 'top');
});
