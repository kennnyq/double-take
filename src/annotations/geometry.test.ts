import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxToBox, cropFromDetect, cropToFrame, frameToCrop, iou, MAX_BOX_AREA, MIN_BOX_SIDE } from './geometry.ts';
import { boxOnStage, videoRect } from '../feed/tells.ts';

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('0..1000 bbox becomes a frame-fraction box', () => {
  // Super VL's real dresser box from the PoC.
  const { box, notes } = bboxToBox([0, 500, 208, 725]);
  assert.deepEqual(box, { x: 0, y: 0.5, w: 0.208, h: 0.225 });
  assert.deepEqual(notes, []);
});

test('fractions, swapped corners and slight overshoot are repaired with a note', () => {
  const frac = bboxToBox([0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(frac.box, { x: 0.1, y: 0.2, w: 0.2, h: 0.2 });
  assert.match(frac.notes[0], /fractions/);

  const swapped = bboxToBox([300, 400, 100, 200]);
  assert.deepEqual(swapped.box, { x: 0.1, y: 0.2, w: 0.2, h: 0.2 });
  assert.equal(swapped.notes.length, 2);

  const over = bboxToBox([900, 900, 1010, 1012]);
  assert.ok(over.box);
  close(over.box!.x + over.box!.w, 1);
});

test('pixel coordinates are rescued only when they fit the image that was sent', () => {
  const px = bboxToBox([540, 960, 1080, 1920], { pixelSize: { w: 1080, h: 1920 } });
  assert.deepEqual(px.box, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  assert.equal(bboxToBox([540, 960, 3600, 6400], { pixelSize: { w: 1080, h: 1920 } }).box, null);
  // Known limit: on images under 1000 px, pixel boxes look like 0..1000 boxes and can't be told apart.
  assert.deepEqual(bboxToBox([180, 320, 360, 640], { pixelSize: { w: 360, h: 640 } }).box, { x: 0.18, y: 0.32, w: 0.18, h: 0.32 });
  assert.equal(bboxToBox([0, 0, 1500, 1500]).box, null);
});

test('malformed bboxes are rejected, not guessed', () => {
  for (const bad of [null, [], [1, 2, 3], ['a', 0, 1, 1], [NaN, 0, 10, 10], [-100, 0, 500, 500], '0,0,1,1', { x: 0 }]) {
    assert.equal(bboxToBox(bad).box, null, JSON.stringify(bad));
  }
  assert.equal(bboxToBox([0, 0, 0, 0]).box, null);
});

test('whole-frame boxes are not localizations (real PoC failure: Omni boxed [0,0,1000,1000])', () => {
  const r = bboxToBox([0, 0, 1000, 1000]);
  assert.equal(r.box, null);
  assert.match(r.notes.at(-1)!, /100% of the frame/);
  assert.ok(bboxToBox([0, 0, 1000, 900]).box === null); // 90%
  assert.ok(bboxToBox([0, 0, 700, 800]).box !== null || 0.56 > MAX_BOX_AREA);
});

test('tiny boxes grow to a visible size around their centre and stay in frame', () => {
  const r = bboxToBox([995, 995, 1000, 1000]);
  assert.ok(r.box);
  close(r.box!.w, MIN_BOX_SIDE);
  close(r.box!.x + r.box!.w, 1);
  close(r.box!.y + r.box!.h, 1);
  const mid = bboxToBox([497, 497, 503, 503]).box!;
  close(mid.x + mid.w / 2, 0.5);
});

test('crop round-trip: a box on a letterbox-cropped image maps back into the full frame', () => {
  const crop = { x: 0, y: 0.25, w: 1, h: 0.5 }; // 16:9 picture inside a 9:16 frame
  const onCrop = { x: 0.5, y: 0, w: 0.5, h: 1 };
  const full = cropToFrame(onCrop, crop);
  assert.deepEqual(full, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
  const back = frameToCrop(full, crop)!;
  close(back.x, 0.5);
  close(back.h, 1);
  assert.equal(frameToCrop({ x: 0, y: 0, w: 1, h: 0.2 }, crop), null);
  const viaBbox = bboxToBox([500, 0, 1000, 1000], { crop });
  assert.deepEqual(viaBbox.box, full);
});

test('cropdetect specs: bars become a crop, noise and dark scenes do not', () => {
  assert.deepEqual(cropFromDetect('720:406:0:437', 720, 1280), { x: 0, y: 437 / 1280, w: 1, h: 406 / 1280 });
  assert.equal(cropFromDetect('720:1272:0:4', 720, 1280), undefined); // < 3% removed
  assert.equal(cropFromDetect('100:100:10:10', 720, 1280), undefined); // both axes: a dark scene, not bars
  assert.deepEqual(cropFromDetect('560:1280:80:0', 720, 1280), { x: 80 / 720, y: 0, w: 560 / 720, h: 1 }); // pillarbox
  assert.equal(cropFromDetect('garbage', 720, 1280), undefined);
  assert.equal(cropFromDetect('800:400:0:0', 720, 1280), undefined); // wider than the frame
});

test('iou', () => {
  const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
  close(iou(a, a), 1);
  close(iou(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 }), 1 / 3);
  assert.equal(iou(a, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }), 0);
});

test('end to end: model bbox → frame box → phone stage, cover vs contain', () => {
  // Dresser on a 720x1280 clip, iPhone 390x844 stage.
  const box = bboxToBox([0, 500, 208, 725]).box!;
  const aspect = 720 / 1280;
  const cover = videoRect(390, 844, aspect, 'cover');
  const onCover = boxOnStage(box, cover, 390, 844)!;
  // Cover crops ~42pt off the left, so part of the dresser is off screen.
  close(onCover.x, 0);
  assert.ok(onCover.w < box.w * cover.w);
  const contain = videoRect(390, 844, aspect, 'contain');
  const onContain = boxOnStage(box, contain, 390, 844)!;
  close(onContain.x, 0);
  close(onContain.w, box.w * 390);
  close(onContain.y, contain.y + 0.5 * contain.h);
});
