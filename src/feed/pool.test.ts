import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL_SIZE, indexFromOffset, isOnPage, isWideLayout, poolWindow } from './pool.ts';

test('pool window covers active and neighbours with unique slots', () => {
  for (let active = 0; active < 20; active++) {
    const slots = poolWindow(active, 20);
    const held = slots.filter((i) => i >= 0).sort((a, b) => a - b);
    assert.equal(held.length, POOL_SIZE);
    assert.ok(held.includes(active));
    if (active > 0) assert.ok(held.includes(active - 1), `prev of ${active}`);
    if (active < 19) assert.ok(held.includes(active + 1), `next of ${active}`);
    slots.forEach((idx, s) => idx >= 0 && assert.equal(idx % POOL_SIZE, s));
  }
});

test('advancing one item recycles exactly one player', () => {
  for (let active = 1; active < 18; active++) {
    const a = poolWindow(active, 20);
    const b = poolWindow(active + 1, 20);
    const changed = a.filter((idx, s) => idx !== b[s]).length;
    assert.equal(changed, 1, `step ${active}`);
  }
});

test('pool window handles short lists and edges', () => {
  assert.deepEqual(poolWindow(0, 0), [-1, -1, -1]);
  assert.deepEqual(poolWindow(0, 1), [0, -1, -1]);
  assert.deepEqual(poolWindow(0, 2), [0, 1, -1]);
  assert.deepEqual(poolWindow(0, 5), [0, 1, 2]);
  assert.deepEqual(poolWindow(4, 5), [3, 4, 2]);
});

test('page index from offset', () => {
  assert.equal(indexFromOffset(0, 800, 10), 0);
  assert.equal(indexFromOffset(799.6, 800, 10), 1);
  assert.equal(indexFromOffset(390, 800, 10), 0);
  assert.equal(indexFromOffset(99999, 800, 10), 9);
  assert.equal(indexFromOffset(-50, 800, 10), 0);
  assert.ok(isOnPage(1600.4, 800));
  assert.ok(!isOnPage(1590, 800));
});

test('wide layout for iPad, not iPhone', () => {
  assert.equal(isWideLayout(393, 852 - 70), false); // iPhone 15
  assert.equal(isWideLayout(820, 1180 - 70), true); // iPad Air portrait
  assert.equal(isWideLayout(1180, 820 - 70), true); // iPad Air landscape
});
