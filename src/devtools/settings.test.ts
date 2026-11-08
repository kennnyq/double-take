import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  changedKeys,
  createSettingsStore,
  parseSettings,
  pipelineChoices,
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

test('parseSettings keeps valid values', () => {
  const s = parseSettings(JSON.stringify({ revealGesture: 'doubleTap', holdMs: 500, pipeline: 'claude', launcher: 'topLeft' }));
  assert.equal(s.holdMs, 500);
  assert.equal(s.pipeline, 'claude');
  assert.equal('revealGesture' in s, false, 'the gesture is a user setting now');
  assert.deepEqual(changedKeys(s).sort(), ['holdMs', 'launcher', 'pipeline']);
});

test('the store reads saved settings, saves changes and notifies', () => {
  const kv = memory({ [STORAGE_KEY]: JSON.stringify({ pipeline: 'claude' }) });
  const store = createSettingsStore(kv);
  assert.equal(store.getSnapshot().pipeline, 'claude');

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
  store.set({ holdMs: 123 as never, pipeline: 'claude', launcher: 'topLeft' });
  assert.equal(store.getSnapshot().holdMs, DEFAULT_SETTINGS.holdMs);
  store.reset(['pipeline']);
  assert.equal(store.getSnapshot().pipeline, 'main');
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
    store.set({ pipeline: 'claude' });
    assert.equal(store.getSnapshot().pipeline, 'claude');
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
