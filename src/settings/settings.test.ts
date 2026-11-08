import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  LEGACY_DEV_STORAGE_KEY,
  SCHEMA,
  STORAGE_KEY,
  createSettingsStore,
  readSettings,
  type AppSettings,
  type KeyValue,
} from './settings.ts';

function memory(initial?: string): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test('readSettings falls back to defaults for missing, corrupt or invalid blobs', () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('[1,2]'), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('{"feedMode":"sideways"}'), DEFAULT_SETTINGS);
});

test('readSettings keeps valid keys and drops unknown ones', () => {
  assert.deepEqual(readSettings('{"feedMode":"onlyAi","retired":true}'), { ...DEFAULT_SETTINGS, feedMode: 'onlyAi' });
});

test('the store loads what was saved', () => {
  const store = createSettingsStore(memory('{"feedMode":"autoLabel"}'));
  assert.equal(store.getSnapshot().feedMode, 'autoLabel');
});

test('set persists, notifies and changes the snapshot identity', () => {
  const kv = memory();
  const store = createSettingsStore(kv);
  const before = store.getSnapshot();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.set('feedMode', 'onlyReal');
  assert.equal(calls, 1);
  assert.notEqual(store.getSnapshot(), before);
  assert.deepEqual(JSON.parse(kv.data.get(STORAGE_KEY)!), { ...DEFAULT_SETTINGS, feedMode: 'onlyReal' });
  // A reload sees the change.
  assert.equal(createSettingsStore(kv).getSnapshot().feedMode, 'onlyReal');
  off();
  store.set('feedMode', 'default');
  assert.equal(calls, 1, 'unsubscribed');
});

test('set ignores no-ops and invalid values', () => {
  const store = createSettingsStore(memory());
  let calls = 0;
  store.subscribe(() => calls++);
  store.set('feedMode', 'default');
  // @ts-expect-error not a feed mode
  store.set('feedMode', 'everything');
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().feedMode, 'default');
});

test('reset restores the defaults', () => {
  const store = createSettingsStore(memory('{"feedMode":"onlyAi"}'));
  store.reset();
  assert.deepEqual(store.getSnapshot(), DEFAULT_SETTINGS);
});

test('works without storage, or with storage that throws', () => {
  const none = createSettingsStore(null);
  none.set('feedMode', 'onlyAi');
  assert.equal(none.getSnapshot().feedMode, 'onlyAi');

  const broken: KeyValue = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  const store = createSettingsStore(broken);
  assert.equal(store.getSnapshot().feedMode, 'default');
  store.set('feedMode', 'autoLabel');
  assert.equal(store.getSnapshot().feedMode, 'autoLabel');
});

test('the double take opens with a hold by default, and takes any of the three gestures', () => {
  assert.equal(DEFAULT_SETTINGS.revealGesture, 'hold');
  for (const g of ['hold', 'doubleTap', 'both'] as const) {
    assert.equal(readSettings(JSON.stringify({ revealGesture: g })).revealGesture, g);
  }
  assert.equal(readSettings('{"revealGesture":"swipe"}').revealGesture, 'hold');
});

test('a gesture saved in the dev settings carries over until one is saved here', () => {
  const dev = JSON.stringify({ revealGesture: 'doubleTap', holdMs: 350 });
  assert.equal(readSettings(null, dev).revealGesture, 'doubleTap');
  assert.equal(readSettings('{"feedMode":"onlyAi"}', dev).revealGesture, 'doubleTap');
  assert.equal(readSettings('{"revealGesture":"both"}', dev).revealGesture, 'both', 'the user setting wins');
  assert.equal(readSettings(null, '{"revealGesture":"wiggle"}').revealGesture, 'hold');
  assert.equal(readSettings(null, '{broken').revealGesture, 'hold');
});

test('the store migrates the dev gesture and saves it as a user setting', () => {
  const kv = memory();
  kv.data.set(LEGACY_DEV_STORAGE_KEY, JSON.stringify({ revealGesture: 'doubleTap' }));
  const store = createSettingsStore(kv);
  assert.equal(store.getSnapshot().revealGesture, 'doubleTap');
  assert.equal(JSON.parse(kv.data.get(STORAGE_KEY)!).revealGesture, 'doubleTap', 'saved at once');
  // The dev blob loses the key later; the user setting stays.
  kv.data.set(LEGACY_DEV_STORAGE_KEY, JSON.stringify({ holdMs: 500 }));
  assert.equal(createSettingsStore(kv).getSnapshot().revealGesture, 'doubleTap');
});

// The feed reads settings through `useSyncExternalStore`, so a change reaches
// the clip on screen as soon as subscribers hear about it. Every setting must
// notify synchronously, with a new snapshot that already holds the new value.
test('every setting notifies subscribers at once with the new value', () => {
  const alternatives: { [K in keyof AppSettings]: AppSettings[K] } = { feedMode: 'onlyReal', revealGesture: 'both' };
  assert.deepEqual(Object.keys(alternatives).sort(), Object.keys(SCHEMA).sort(), 'a new setting needs a case here');
  for (const key of Object.keys(alternatives) as (keyof AppSettings)[]) {
    const store = createSettingsStore(null);
    assert.notEqual(store.getSnapshot()[key], alternatives[key]);
    const seen: unknown[] = [];
    store.subscribe(() => seen.push(store.getSnapshot()[key]));
    store.set(key, alternatives[key]);
    assert.deepEqual(seen, [alternatives[key]], key);
  }
});
