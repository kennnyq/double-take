import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, STORAGE_KEY, createSettingsStore, readSettings, type KeyValue } from './settings.ts';

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
  assert.deepEqual(readSettings('{"feedMode":"onlyAi","retired":true}'), { feedMode: 'onlyAi' });
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
  assert.deepEqual(JSON.parse(kv.data.get(STORAGE_KEY)!), { feedMode: 'onlyReal' });
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
