import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPOTLIGHT_SHAPES, bands, featherLayers, grow, holeFor, holePath, mixHole, openHole, stackedAlpha } from './spotlight.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const BOX = { x: 100, y: 200, w: 80, h: 40 };

test('holeFor: every shape is centred on the box and contains it', () => {
  for (const shape of SPOTLIGHT_SHAPES) {
    const h = holeFor(BOX, shape);
    close(h.x + h.w / 2, 140);
    close(h.y + h.h / 2, 220);
    if (h.ellipse) {
      // The box's corners lie inside the ellipse.
      const v = (40 / (h.w / 2)) ** 2 + (20 / (h.h / 2)) ** 2;
      assert.ok(v <= 1 + 1e-9, `${shape}: corners inside (${v})`);
    } else {
      assert.ok(h.w >= BOX.w && h.h >= BOX.h, shape);
    }
  }
});

test('holeFor: circle is round, blob is a capsule, rect is sharp, tiny boxes grow', () => {
  const c = holeFor(BOX, 'circle');
  assert.equal(c.w, c.h);
  const b = holeFor(BOX, 'blob');
  assert.equal(b.radius, Math.min(b.w, b.h) / 2);
  assert.equal(holeFor(BOX, 'rect').radius, 0);
  assert.equal(holeFor(BOX, 'rect').feather, 0);
  const tiny = holeFor({ x: 10, y: 10, w: 4, h: 4 }, 'rect');
  assert.ok(tiny.w >= 44 && tiny.h >= 44);
});

test('grow keeps the centre and offsets the radius', () => {
  const h = holeFor(BOX, 'feather');
  const g = grow(h, 10);
  close(g.x + g.w / 2, h.x + h.w / 2);
  close(g.w, h.w + 20);
  close(g.radius, h.radius + 10);
  assert.equal(grow(h, -1000).w, 2);
});

test('featherLayers: stacked, the darkness ramps evenly up to the dim level', () => {
  const h = holeFor(BOX, 'feather');
  const layers = featherLayers(h, 0.6, 5);
  assert.equal(layers.length, 5);
  for (let k = 1; k <= 5; k++) close(stackedAlpha(layers.slice(0, k).map((l) => l.alpha)), (0.6 * k) / 5);
  // Holes spread across the feather, inner first, centred on the shape's edge.
  close(layers[0].hole.w, h.w - h.feather);
  close(layers[4].hole.w, h.w + h.feather);
  // No feather: one layer at full dim.
  assert.deepEqual(featherLayers(holeFor(BOX, 'rect'), 0.5).map((l) => l.alpha), [0.5]);
});

test('openHole takes in the whole stage; mixHole moves between holes', () => {
  const h = holeFor(BOX, 'rounded');
  const o = openHole(400, 800, h);
  assert.ok(o.x < 0 && o.y < 0 && o.x + o.w > 400 && o.y + o.h > 800);
  const half = mixHole(o, h, 0.5);
  close(half.w, (o.w + h.w) / 2);
  assert.deepEqual(mixHole(o, h, 1), { ...h });
});

test('holePath: an even-odd path of the stage with the hole cut out', () => {
  const rect = holePath(400, 800, holeFor(BOX, 'rect'));
  assert.ok(rect.startsWith('M0 0H400V800H0Z'));
  assert.match(rect, /M96 196H184V244H96Z$/);
  assert.match(holePath(400, 800, holeFor(BOX, 'rounded')), /A14 14 0 0 1/);
  assert.equal((holePath(400, 800, holeFor(BOX, 'ellipse')).match(/A/g) ?? []).length, 2);
});

test('bands tile the stage around the hole, clipped to it', () => {
  const b = bands(400, 800, { x: 100, y: 200, w: 80, h: 40 });
  const area = b.reduce((s, r) => s + r.w * r.h, 0);
  close(area, 400 * 800 - 80 * 40);
  // A hole hanging off the stage edge leaves no negative bands.
  for (const r of bands(400, 800, { x: -50, y: 780, w: 100, h: 100 })) assert.ok(r.w >= 0 && r.h >= 0);
  // A hole bigger than the stage leaves nothing to blur.
  assert.equal(bands(400, 800, { x: -10, y: -10, w: 500, h: 900 }).reduce((s, r) => s + r.w * r.h, 0), 0);
});
