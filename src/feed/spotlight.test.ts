import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MASK_BOX,
  MASK_SHAPES,
  MASK_SIZE,
  SPOTLIGHT_SHAPES,
  bands,
  clipTransforms,
  grow,
  holeFor,
  maskFor,
  maskPlacement,
} from './spotlight.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const BOX = { x: 100, y: 200, w: 80, h: 40 };

test('holeFor: every shape is centred on the box and contains it', () => {
  for (const shape of SPOTLIGHT_SHAPES) {
    const h = holeFor(BOX, shape);
    close(h.x + h.w / 2, 140);
    close(h.y + h.h / 2, 220);
    if (MASK_SHAPES[maskFor(shape)].kind === 'ellipse') {
      // The box's corners lie inside the ellipse.
      const v = (40 / (h.w / 2)) ** 2 + (20 / (h.h / 2)) ** 2;
      assert.ok(v <= 1 + 1e-9, `${shape}: corners inside (${v})`);
    } else {
      assert.ok(h.w >= BOX.w && h.h >= BOX.h, shape);
    }
  }
});

test('holeFor: circle is round, rect is sharp, tiny boxes grow', () => {
  const c = holeFor(BOX, 'circle');
  assert.equal(c.w, c.h);
  assert.equal(holeFor(BOX, 'rect').feather, 0);
  const tiny = holeFor({ x: 10, y: 10, w: 4, h: 4 }, 'rect');
  assert.ok(tiny.w >= 44 && tiny.h >= 44);
});

test('grow keeps the centre', () => {
  const h = holeFor(BOX, 'feather');
  const g = grow(h, 10);
  close(g.x + g.w / 2, h.x + h.w / 2);
  close(g.w, h.w + 20);
  assert.equal(grow(h, -1000).w, 2);
});

test('every shape has its prepared images', () => {
  const dir = fileURLToPath(new URL('../../assets/spotlight/', import.meta.url));
  for (const shape of SPOTLIGHT_SHAPES) {
    const name = maskFor(shape);
    assert.ok(MASK_SHAPES[name], shape);
    assert.ok(existsSync(`${dir}hole-${name}.png`) && existsSync(`${dir}spot-${name}.png`), `${name} images (node scripts/spotlight-masks.ts)`);
  }
});

test('maskPlacement lands the image box on the hole', () => {
  const h = holeFor(BOX, 'ellipse');
  const r = maskPlacement(h);
  const k = MASK_SIZE / MASK_BOX;
  close(r.w, h.w * k);
  close(r.h, h.h * k);
  // The central box of the image is the hole.
  close(r.x + (r.w - r.w / k) / 2, h.x);
  close(r.y + (r.h - r.h / k) / 2, h.y);
});

test('bands tile the stage around the hole, clipped to it', () => {
  const b = bands(400, 800, { x: 100, y: 200, w: 80, h: 40 });
  const area = b.reduce((s, r) => s + r.w * r.h, 0);
  close(area, 400 * 800 - 80 * 40);
  for (const r of bands(400, 800, { x: -50, y: 780, w: 100, h: 100 })) assert.ok(r.w >= 0 && r.h >= 0);
  assert.equal(bands(400, 800, { x: -10, y: -10, w: 500, h: 900 }).reduce((s, r) => s + r.w * r.h, 0), 0);
});

/** Applies a transform the way React Native does: translate, then scale about the view's centre. */
const apply = (t: { tx: number; ty: number; sx: number; sy: number }, W: number, H: number, x: number, y: number) => ({
  x: W / 2 + t.tx + t.sx * (x - W / 2),
  y: H / 2 + t.ty + t.sy * (y - H / 2),
});

test('clipTransforms: the clip lands on the area and its child stays put', () => {
  const W = 430;
  const H = 860;
  const r = { x: 60, y: 300, w: 180, h: 120 };
  const { outer, inner } = clipTransforms(W, H, r);
  // The clip's corners map onto the area.
  const tl = apply(outer, W, H, 0, 0);
  const br = apply(outer, W, H, W, H);
  close(tl.x, r.x);
  close(tl.y, r.y);
  close(br.x, r.x + r.w);
  close(br.y, r.y + r.h);
  // A point of the child, through both transforms, ends where it started.
  for (const [x, y] of [
    [0, 0],
    [123, 456],
    [W, H],
  ]) {
    const inChild = apply(inner, W, H, x, y);
    const out = apply(outer, W, H, inChild.x, inChild.y);
    close(out.x, x, 1e-6);
    close(out.y, y, 1e-6);
  }
});
