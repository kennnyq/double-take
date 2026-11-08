import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atlasMode, cellRect, cellsById, clipTime, galleryPicks, MAX_BOARD_SIDE, parseAtlas, planBoard } from './atlas.ts';

const MANIFEST = {
  version: 1,
  src: 'atlas.mp4',
  poster: 'atlas.jpg',
  cols: 6,
  rows: 4,
  cellW: 144,
  cellH: 256,
  fps: 15,
  loop: 7,
  lead: 0.5,
  ids: ['a', 'b', 'c'],
};

test('parseAtlas resolves media next to the manifest', () => {
  const local = parseAtlas(MANIFEST, '/gallery-atlas/atlas.json');
  assert.equal(local?.srcUrl, '/gallery-atlas/atlas.mp4');
  assert.equal(local?.posterUrl, '/gallery-atlas/atlas.jpg');
  const remote = parseAtlas(MANIFEST, 'https://cdn.test/m/atlas/v3/atlas.json?sig=1');
  assert.equal(remote?.srcUrl, 'https://cdn.test/m/atlas/v3/atlas.mp4');
});

test('parseAtlas rejects what is not a manifest', () => {
  assert.equal(parseAtlas(null, '/a.json'), null);
  assert.equal(parseAtlas('<!doctype html>', '/a.json'), null);
  assert.equal(parseAtlas({ ...MANIFEST, version: 2 }, '/a.json'), null);
  assert.equal(parseAtlas({ ...MANIFEST, cols: 0 }, '/a.json'), null);
  // More clips than cells.
  assert.equal(parseAtlas({ ...MANIFEST, cols: 1, rows: 2 }, '/a.json'), null);
  assert.equal(parseAtlas({ ...MANIFEST, lead: undefined }, '/a.json')?.lead, 0);
});

test('parseAtlas keeps look-alike distances only when they cover every clip', () => {
  const d = [
    [0, 0.2, 0.3],
    [0.2, 0, 0.1],
    [0.3, 0.1, 0],
  ];
  assert.deepEqual(parseAtlas({ ...MANIFEST, distances: d }, '/a.json')?.distances, d);
  assert.equal(parseAtlas({ ...MANIFEST, distances: d.slice(1) }, '/a.json')?.distances, undefined);
  assert.equal(parseAtlas({ ...MANIFEST, distances: [[0], [0], [0]] }, '/a.json')?.distances, undefined);
});

test('parseAtlas keeps per-cell phases and the codec, and drops phases that do not fit', () => {
  const a = parseAtlas({ ...MANIFEST, phases: [0, 4.4, 1.6], mime: 'video/mp4; codecs="avc1.64001f"' }, '/a.json');
  assert.deepEqual(a?.phases, [0, 4.4, 1.6]);
  assert.equal(a?.mime, 'video/mp4; codecs="avc1.64001f"');
  assert.equal(parseAtlas({ ...MANIFEST, phases: [0, 1] }, '/a.json')?.phases, undefined);
  assert.equal(parseAtlas({ ...MANIFEST, phases: [0, 'x', 1] }, '/a.json')?.phases, undefined);
});

test('galleryPicks: the atlas\'s clips the feed still has, in atlas order; else the first portrait ones', () => {
  const feed = [
    { sourceId: 'c', aspect: 0.56 },
    { sourceId: 'x', aspect: 1.78 },
    { sourceId: 'a', aspect: 0.56 },
    { sourceId: 'b' },
  ];
  // 'z' has left the feed; the gallery follows the atlas, not the feed's order.
  assert.deepEqual(galleryPicks(feed, { ids: ['a', 'z', 'c'] }, 48), [
    { index: 2, cell: 0 },
    { index: 0, cell: 2 },
  ]);
  // No atlas: the first portrait clips (landscape skipped), up to the size.
  assert.deepEqual(galleryPicks(feed, null, 2), [{ index: 0 }, { index: 2 }]);
});

test('cells are found by clip id and laid out row by row', () => {
  assert.deepEqual([...cellsById(MANIFEST)], [['a', 0], ['b', 1], ['c', 2]]);
  assert.deepEqual(cellRect(MANIFEST, 0), { sx: 0, sy: 0, sw: 144, sh: 256 });
  assert.deepEqual(cellRect(MANIFEST, 7), { sx: 144, sy: 256, sw: 144, sh: 256 });
});

test('clipTime maps the loop back onto the clip', () => {
  assert.equal(clipTime(MANIFEST, 0), 0.5);
  assert.equal(clipTime(MANIFEST, 3), 3.5);
  assert.equal(clipTime(MANIFEST, 7.25), 0.75);
  // An endless timeline (Media Source) just keeps counting.
  assert.equal(clipTime(MANIFEST, 70 + 3), 3.5);
});

test("clipTime follows each cell's own loop", () => {
  const phased = { ...MANIFEST, phases: [0, 4, 6.5] };
  assert.equal(clipTime(phased, 1, 0), 1.5);
  assert.equal(clipTime(phased, 1, 1), 5.5);
  // Past its loop's end, back to its start.
  assert.equal(clipTime(phased, 1, 2), 1);
});

test('planBoard draws at the atlas resolution, not the screen', () => {
  // A row of two 9:16 tiles, 234 CSS px tall, 12 px apart.
  const plan = planBoard(MANIFEST, 280, 234, [
    { cell: 0, x: 0, y: 0, w: 132, h: 234 },
    { cell: 7, x: 144, y: 0, w: 132, h: 234 },
  ])!;
  assert.ok(Math.abs(plan.scale - 256 / 234) < 1e-9);
  assert.equal(plan.height, 256);
  assert.equal(plan.draws[1].dx, 144 * plan.scale);
  assert.equal(Math.round(plan.draws[1].sy), 256);
});

test('planBoard keeps sub-pixel positions, so a strip\'s halves stay exactly a half apart', () => {
  const tiles = [0, 1, 2, 3].map((i) => ({ cell: i, x: i * 143.4375, y: 0, w: 131.4375, h: 233.67 }));
  const plan = planBoard(MANIFEST, 4 * 143.4375, 233.67, tiles)!;
  const half = 2 * 143.4375 * plan.scale;
  assert.ok(Math.abs(plan.draws[2].dx - plan.draws[0].dx - half) < 1e-9);
  assert.ok(Math.abs(plan.draws[3].dx - plan.draws[1].dx - half) < 1e-9);
});

test('planBoard crops cells to the tile like object-fit: cover', () => {
  // A square tile takes the cell's middle square.
  const [d] = planBoard(MANIFEST, 100, 100, [{ cell: 0, x: 0, y: 0, w: 100, h: 100 }])!.draws;
  assert.equal(d.sw, 144);
  assert.equal(d.sh, 144);
  assert.equal(d.sy, 56);
});

test('planBoard keeps huge boards within canvas limits and skips empty ones', () => {
  const plan = planBoard(MANIFEST, 20000, 100, [{ cell: 0, x: 0, y: 0, w: 50, h: 89 }])!;
  assert.ok(plan.width <= MAX_BOARD_SIDE);
  assert.equal(planBoard(MANIFEST, 100, 100, []), null);
});

test('atlasMode: still for reduced motion, save-data and slow connections', () => {
  assert.equal(atlasMode({ reducedMotion: false }), 'play');
  assert.equal(atlasMode({ reducedMotion: false, effectiveType: '4g' }), 'play');
  assert.equal(atlasMode({ reducedMotion: true }), 'still');
  assert.equal(atlasMode({ reducedMotion: false, saveData: true }), 'still');
  assert.equal(atlasMode({ reducedMotion: false, effectiveType: '3g' }), 'still');
  assert.equal(atlasMode({ reducedMotion: false, effectiveType: 'slow-2g' }), 'still');
});
