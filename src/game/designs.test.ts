import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESIGNS, GAME_DESIGNS, GAME_ELEMENTS, parseDesigns, stepDesign } from './designs.ts';

test('every element has 2–4 designs, unique ids, and a default among them', () => {
  for (const e of GAME_ELEMENTS) {
    const ids = GAME_DESIGNS[e].options.map((o) => o.id);
    assert.ok(ids.length >= 2 && ids.length <= 4, e);
    assert.equal(new Set(ids).size, ids.length, e);
    assert.ok((ids as readonly string[]).includes(DEFAULT_DESIGNS[e]), e);
    assert.ok(GAME_DESIGNS[e].why.length > 20, `${e} says why`);
  }
});

test('stored designs: unknown values fall back to the default', () => {
  assert.deepEqual(parseDesigns(null), DEFAULT_DESIGNS);
  assert.deepEqual(parseDesigns({ hud: 'ring', countdown: 'nope', reveal: 3 }), { ...DEFAULT_DESIGNS, hud: 'ring' });
});

test('stepping wraps round', () => {
  const ids = GAME_DESIGNS.hud.options.map((o) => o.id);
  assert.equal(stepDesign('hud', ids[ids.length - 1], 1), ids[0]);
  assert.equal(stepDesign('hud', ids[0], -1), ids[ids.length - 1]);
  assert.equal(stepDesign('hud', 'unknown', 1), ids[1]);
});
