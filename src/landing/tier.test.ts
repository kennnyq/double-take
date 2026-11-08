import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTier } from './tier.ts';

test('phones (small and touch) get the light tier', () => {
  assert.equal(pickTier({ shortSide: 393, coarse: true, cores: 6 }), 'phone');
  assert.equal(pickTier({ shortSide: 390, coarse: true }), 'phone');
});

test('a big touch screen, or a small window on a desktop, gets the full one', () => {
  assert.equal(pickTier({ shortSide: 1024, coarse: true, cores: 8 }), 'full');
  assert.equal(pickTier({ shortSide: 500, coarse: false, cores: 8, memory: 16 }), 'full');
});

test('slow machines get the light tier whatever their size', () => {
  assert.equal(pickTier({ shortSide: 1080, coarse: false, cores: 4 }), 'phone');
  assert.equal(pickTier({ shortSide: 1080, coarse: false, cores: 8, memory: 2 }), 'phone');
});

test('the design on trial forces either tier', () => {
  assert.equal(pickTier({ shortSide: 393, coarse: true }, 'full'), 'full');
  assert.equal(pickTier({ shortSide: 2000, coarse: false, cores: 16 }, 'phone'), 'phone');
});
