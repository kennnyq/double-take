import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  changedKeys,
  createSettingsStore,
  parseSettings,
  pipelineChoices,
  resolvePipeline,
  variantIndex,
  type KeyValue,
} from './settings.ts';

function memory(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

test('parseSettings falls back to the defaults for missing, corrupt or invalid values', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('[1,2]'), DEFAULT_SETTINGS);
  const s = parseSettings(JSON.stringify({ holdMs: 999, pipeline: '../x y', launcher: 'middle' }));
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('parseSettings reads the double take spotlight settings', () => {
  const s = parseSettings(JSON.stringify({ spotlightEffect: 'cheapBlur', spotlightStrength: 3, spotlightShape: 'ellipse', markDrafts: true }));
  assert.equal(s.spotlightEffect, 'cheapBlur');
  assert.equal(s.spotlightStrength, 3);
  assert.equal(s.spotlightShape, 'ellipse');
  assert.equal(s.markDrafts, true);
  const bad = parseSettings(JSON.stringify({ spotlightEffect: 'glow', spotlightStrength: 9, spotlightShape: 'star', markDrafts: 'yes' }));
  assert.equal(bad.spotlightEffect, DEFAULT_SETTINGS.spotlightEffect);
  assert.equal(bad.spotlightStrength, DEFAULT_SETTINGS.spotlightStrength);
  assert.equal(bad.spotlightShape, DEFAULT_SETTINGS.spotlightShape);
  assert.equal(bad.markDrafts, false);
});

test('the text reveal defaults to the word wave, and reads the others', () => {
  assert.equal(DEFAULT_SETTINGS.textReveal, 'siri');
  assert.equal(parseSettings(JSON.stringify({ textReveal: 'wwdc' })).textReveal, 'wwdc');
  assert.equal(parseSettings(JSON.stringify({ textReveal: 'typewriter' })).textReveal, 'siri');
  assert.equal(DEFAULT_SETTINGS.tabBarInDoubleTake, 'stay');
  assert.equal(parseSettings(JSON.stringify({ tabBarInDoubleTake: 'fade' })).tabBarInDoubleTake, 'fade');
  assert.equal(parseSettings(JSON.stringify({ tabBarInDoubleTake: 'slide' })).tabBarInDoubleTake, 'stay');
});

test('the end cue defaults to both and preserves explicit choices', () => {
  assert.equal(DEFAULT_SETTINGS.endCue, 'both');
  assert.equal(DEFAULT_SETTINGS.spotlightPadding, 'roomy');
  assert.equal(parseSettings(JSON.stringify({ spotlightPadding: 'tight' })).spotlightPadding, 'tight');
  for (const endCue of ['both', 'done', 'dots']) assert.equal(parseSettings(JSON.stringify({ endCue })).endCue, endCue);
  assert.equal(parseSettings(JSON.stringify({ endCue: 'dots' })).endCue, 'dots');
  assert.equal(parseSettings(JSON.stringify({ endCue: 'fireworks' })).endCue, 'both');
});

test('the spotlight defaults to darken only, and a first-version pick falls back to it', () => {
  assert.equal(DEFAULT_SETTINGS.spotlightEffect, 'darken');
  assert.equal(parseSettings(JSON.stringify({ spotlight: 'both' })).spotlightEffect, 'darken');
});

test('parseSettings keeps valid values', () => {
  const s = parseSettings(JSON.stringify({ revealGesture: 'doubleTap', holdMs: 500, pipelinePick: 'claude', launcher: 'topLeft' }));
  assert.equal(s.holdMs, 500);
  assert.equal(s.pipelinePick, 'claude');
  assert.equal('revealGesture' in s, false, 'the gesture is a user setting now');
  assert.deepEqual(changedKeys(s).sort(), ['holdMs', 'launcher', 'pipelinePick']);
});

test('the store reads saved settings, saves changes and notifies', () => {
  const kv = memory({ [STORAGE_KEY]: JSON.stringify({ pipelinePick: 'claude' }) });
  const store = createSettingsStore(kv);
  assert.equal(store.getSnapshot().pipelinePick, 'claude');

  let calls = 0;
  const off = store.subscribe(() => calls++);
  const before = store.getSnapshot();
  store.set({ holdMs: 500 });
  assert.equal(calls, 1);
  assert.notEqual(store.getSnapshot(), before, 'a new snapshot so React re-renders');
  assert.equal(JSON.parse(kv.data[STORAGE_KEY]).holdMs, 500);

  store.set({ holdMs: 500 }); // no change, no notification
  assert.equal(calls, 1);
  off();
  store.set({ holdMs: 250 });
  assert.equal(calls, 1);
});

test('the store rejects invalid values and resets keys or everything', () => {
  const store = createSettingsStore(memory());
  store.set({ holdMs: 123 as never, pipelinePick: 'claude', launcher: 'topLeft' });
  assert.equal(store.getSnapshot().holdMs, DEFAULT_SETTINGS.holdMs);
  store.reset(['pipelinePick']);
  assert.equal(store.getSnapshot().pipelinePick, '');
  assert.equal(store.getSnapshot().launcher, 'topLeft');
  store.reset();
  assert.deepEqual(store.getSnapshot(), DEFAULT_SETTINGS);
});

test('the store works without storage, or when storage throws', () => {
  const broken: KeyValue = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  for (const kv of [null, broken]) {
    const store = createSettingsStore(kv);
    assert.deepEqual(store.getSnapshot(), DEFAULT_SETTINGS);
    store.set({ pipelinePick: 'claude' });
    assert.equal(store.getSnapshot().pipelinePick, 'claude');
  }
});

test('pipelineChoices puts main first and keeps the saved pick', () => {
  assert.deepEqual(pipelineChoices(['claude', 'main', 'claude', 'beta'], 'main'), ['main', 'beta', 'claude']);
  assert.deepEqual(pipelineChoices([], 'claude'), ['main', 'claude']);
});

test('variantIndex picks the global pipeline, else main', () => {
  const v = [{ name: 'main' }, { name: 'claude' }];
  assert.equal(variantIndex(v, 'claude'), 1);
  assert.equal(variantIndex(v, 'main'), 0);
  assert.equal(variantIndex(v, 'beta'), 0);
});

test('a saved pipeline from before cloud defaults counts only if it was a real pick', () => {
  // Every old saved state had pipeline: 'main', picked or not: that now follows the default.
  assert.equal(parseSettings(JSON.stringify({ pipeline: 'main' })).pipelinePick, '');
  assert.equal(parseSettings(JSON.stringify({ pipeline: 'claude' })).pipelinePick, 'claude');
  // The new key wins, and an explicit main is kept.
  assert.equal(parseSettings(JSON.stringify({ pipeline: 'claude', pipelinePick: 'main' })).pipelinePick, 'main');
  assert.equal(parseSettings(JSON.stringify({ pipelinePick: '../x' })).pipelinePick, '');
});

test('resolvePipeline: your pick, else a valid cloud default, else main', () => {
  assert.equal(resolvePipeline('', null), 'main');
  assert.equal(resolvePipeline('', 'claude'), 'claude');
  assert.equal(resolvePipeline('main', 'claude'), 'main');
  assert.equal(resolvePipeline('beta', 'claude'), 'beta');
  for (const bad of [42, '', '../x', { name: 'claude' }, 'x'.repeat(41)]) assert.equal(resolvePipeline('', bad), 'main');
});
