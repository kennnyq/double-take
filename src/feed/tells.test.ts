import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeTells, boxOnStage, fitFor, parseTells, videoRect, type Tell } from './tells.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('fitFor fills the screen with portrait clips and letterboxes the rest', () => {
  assert.equal(fitFor(undefined), 'cover');
  assert.equal(fitFor(9 / 16), 'cover');
  assert.equal(fitFor(770 / 1280), 'cover');
  assert.equal(fitFor(1), 'contain');
  assert.equal(fitFor(16 / 9), 'contain');
});

test('videoRect: landscape clip contained in a phone stage is centred vertically', () => {
  const r = videoRect(390, 844, 16 / 9, 'contain');
  close(r.x, 0);
  close(r.w, 390);
  close(r.h, 390 / (16 / 9));
  close(r.y, (844 - r.h) / 2);
});

test('videoRect: portrait clip covering a wider stage is cropped top and bottom', () => {
  const r = videoRect(400, 600, 9 / 16, 'cover');
  close(r.w, 400);
  close(r.h, 400 / (9 / 16));
  assert.ok(r.y < 0);
  close(r.y, (600 - r.h) / 2);
});

test('boxOnStage maps frame fractions to stage pixels', () => {
  const frame = { x: 0, y: 312.5, w: 390, h: 219.375 };
  const b = boxOnStage({ x: 0.5, y: 0, w: 0.5, h: 1 }, frame, 390, 844)!;
  close(b.x, 195);
  close(b.y, 312.5);
  close(b.w, 195);
  close(b.h, 219.375);
});

test('boxOnStage clips to the stage and drops boxes cropped away', () => {
  const frame = { x: -100, y: 0, w: 600, h: 844 }; // cover crop: 100px off each side
  const b = boxOnStage({ x: 0, y: 0.1, w: 0.25, h: 0.1 }, frame, 400, 844)!;
  close(b.x, 0);
  close(b.w, 50); // 150px wide box, 100px of it off screen
  assert.equal(boxOnStage({ x: 0, y: 0, w: 0.1, h: 0.1 }, frame, 400, 844), null);
});

const TELLS: Tell[] = [
  { id: 'a', category: 'text', label: 'Garbled sign', t0: 0, t1: 1.8, box: { x: 0.58, y: 0.06, w: 0.42, h: 0.3 } },
  { id: 'b', category: 'physics', label: 'Sign folds like cloth', t0: 2.5, t1: 5, box: { x: 0.4, y: 0.04, w: 0.6, h: 0.55 } },
];

test('activeTells honours time windows with slack', () => {
  assert.deepEqual(activeTells(TELLS, 1).map((t) => t.id), ['a']);
  assert.deepEqual(activeTells(TELLS, 2.0).map((t) => t.id), ['a']);
  assert.deepEqual(activeTells(TELLS, 2.3).map((t) => t.id), ['b']);
  assert.deepEqual(activeTells(TELLS, 6).map((t) => t.id), []);
});

test('parseTells keeps well-formed tells and drops the rest', () => {
  const ok = parseTells({ tells: [...TELLS, { label: 'bad', t0: 3, t1: 1, box: TELLS[0].box }, { label: 'x', t0: 0, t1: 1, box: { x: 2, y: 0, w: 1, h: 1 } }] });
  assert.deepEqual(ok.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(parseTells(null), []);
  assert.deepEqual(parseTells({ tells: 'nope' }), []);
});
