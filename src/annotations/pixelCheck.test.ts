import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChangeCheck, findChange, regionDiff, wantsChangeCheck, type GrayFrame } from './pixelCheck.ts';
import { readTell, type Tell } from './format.ts';
import { stepCopy } from './walkthrough.ts';

const W = 20;
const H = 20;
/** A flat frame with an optional bright square (the "object") and global noise level. */
function frame(t: number, { object = true, shift = 0 } = {}): GrayFrame {
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inObj = object && x < 5 && y >= 10 && y < 15;
      px[y * W + x] = inObj ? 200 : 60 + shift;
    }
  }
  return { t, w: W, h: H, px };
}
const BOX = { x: 0, y: 0.5, w: 0.25, h: 0.25 };

test('regionDiff separates change inside the box from the rest', () => {
  const r = regionDiff(frame(0), frame(1, { object: false }), BOX);
  assert.equal(r.inside, 140);
  assert.equal(r.outside, 0);
  assert.throws(() => regionDiff(frame(0), { ...frame(1), w: 10 }, BOX));
});

test('finds the first frame where the object is gone (model said one frame too early)', () => {
  const frames = [frame(5.5), frame(6), frame(6.5, { object: false }), frame(7, { object: false })];
  const r = findChange(frames, 5.5, BOX);
  assert.equal(r.changeT, 6.5);
  assert.equal(r.unchanged, false);
  assert.equal(r.samples.length, 3);
});

test('a region that never changes is flagged (the detector that "disappears completely")', () => {
  const frames = [frame(5.5), frame(6, { shift: 2 }), frame(7, { shift: 3 })];
  const r = findChange(frames, 5.5, BOX);
  assert.equal(r.changeT, null);
  assert.equal(r.unchanged, true);
});

test('whole-scene change (camera cut, exposure) is not credited to the region', () => {
  const frames = [frame(1), frame(2, { object: false, shift: 100 })];
  // Inside changes by |200-160|=40 while outside changes by 100: the region isn't special.
  const r = findChange(frames, 1, BOX);
  assert.equal(r.changeT, null);
  assert.equal(r.unchanged, false);
});

test('searches backwards for things that appear, respects the gap, needs a frame at the focus time', () => {
  const frames = [frame(1, { object: false }), frame(2), frame(3)];
  assert.equal(findChange(frames, 2, BOX, { direction: -1 }).changeT, 1);
  assert.equal(findChange(frames, 3, BOX, { direction: -1, maxGap: 1 }).changeT, null);
  assert.deepEqual(findChange(frames, 2.5, BOX), { changeT: null, unchanged: false, samples: [] });
});

test('applyChangeCheck: moves a wrong after moment, flags a still region, leaves inconclusive alone', () => {
  const tell: Tell = { id: 'd', category: 'continuity', label: 'Dresser vanishes', t0: 4.5, t1: 6.5, focusT: 5.5, compareT: 6, box: BOX, confidence: 'high' };
  assert.ok(wantsChangeCheck(tell));
  assert.ok(!wantsChangeCheck({ ...tell, box: undefined }));
  assert.ok(!wantsChangeCheck({ ...tell, compareT: undefined, category: 'text' }));

  const moved = applyChangeCheck(tell, { changeT: 6.5, unchanged: false, samples: [] }, 15);
  assert.equal(moved.tell.compareT, 6.5);
  assert.equal(moved.tell.pixelCheck, 'changed');
  assert.ok(moved.tell.t1 >= 6.8);
  assert.match(moved.note!, /unchanged at the model's 6s/);

  const still = applyChangeCheck(tell, { changeT: null, unchanged: true, samples: [{ t: 6, inside: 2.8, outside: 9 }] }, 15);
  assert.equal(still.tell.compareT, undefined);
  assert.equal(still.tell.pixelCheck, 'unchanged');
  assert.equal(still.tell.confidence, 'low');
  assert.match(still.note!, /barely changes \(max diff 2.8/);
  assert.equal(stepCopy(still.tell, 0, 1).doubtful, true);

  const same = applyChangeCheck(tell, { changeT: null, unchanged: false, samples: [] }, 15);
  assert.equal(same.tell, tell);
  assert.equal(same.note, null);
  // The result still reads back through the app's reader.
  assert.deepEqual(readTell(JSON.parse(JSON.stringify(moved.tell))), moved.tell);
});

test('a moving camera blocks the comparison instead of faking a change (bike POV trailer clip)', () => {
  // Every pixel changes a lot: the scene, not the region.
  const swing = (t: number, v: number): GrayFrame => ({ t, w: W, h: H, px: new Uint8Array(W * H).fill(v) });
  const r = findChange([swing(5.8, 20), swing(7.1, 90)], 5.8, BOX);
  assert.equal(r.unstable, true);
  assert.equal(r.changeT, null);
  assert.equal(r.unchanged, false);
  const tell: Tell = { id: 't', category: 'continuity', label: 'Trailer vanishes', t0: 4.8, t1: 7.4, focusT: 5.8, compareT: 7.1, box: BOX };
  const out = applyChangeCheck(tell, r, 10);
  assert.equal(out.tell.compareT, undefined);
  assert.equal(out.tell.pixelCheck, undefined);
  assert.match(out.note!, /camera moves too much/);
  // Unstable frames are skipped, stable ones still count.
  const mixed = findChange([frame(1), swing(1.5, 200), frame(2, { object: false })], 1, BOX);
  assert.equal(mixed.changeT, 2);
});
