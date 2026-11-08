import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seekTimeFor } from '../../../src/annotations/walkthrough.ts';
import type { Tell } from '../../../src/annotations/format.ts';
import { DEFAULT_FILTER, buildQueue, decided, nextIndex, sourceOptions, type QueueItem } from './queue.ts';
import { clock, focusTime, markers, runLabel, stepFrom, tellRef } from './timeline.ts';
import { checkPatch } from '../decisions.ts';

const media = (tells = 0) => ({ duration: 10, tells: Array.from({ length: tells }, (_, i) => ({ name: `m${i}`, url: 'u' })) });
const item = (key: string, ins: QueueItem['in'], m: QueueItem['media'] = media()): QueueItem => ({ key, in: ins, media: m });
const demo = (index: number) => ({ kind: 'feed' as const, source: 'local', name: 'demo', index });
const batch = (name: string, index: number) => ({ kind: 'batch' as const, name, index });
const ORDER = ['feed:local/demo', 'batch:real-2026-11-07'];

const ITEMS = [
  item('a', [demo(1)]),
  item('b', [demo(0), batch('real-2026-11-07', 3)], media(2)),
  item('c', [batch('real-2026-11-07', 0)], media(1)),
  item('d', [batch('spot_test', 0)], null),
];

test('the default queue is unreviewed, built clips, tells first, then source order', () => {
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(), DEFAULT_FILTER, ORDER), ['b', 'c', 'a']);
});

test('keep and drop decide a clip; needs-work stays in the unreviewed queue', () => {
  const states = { b: { status: 'keep' as const }, c: { status: 'needs-work' as const }, a: { status: 'discard' as const } };
  assert.deepEqual(buildQueue(ITEMS, states, new Set(), DEFAULT_FILTER, ORDER), ['c']);
  assert.deepEqual(buildQueue(ITEMS, states, new Set(), { ...DEFAULT_FILTER, status: 'keep' }, ORDER), ['b']);
  assert.deepEqual(buildQueue(ITEMS, states, new Set(), { ...DEFAULT_FILTER, status: 'discard' }, ORDER), ['a']);
  assert.equal(decided({ status: 'needs-work' }), null);
  assert.equal(decided(undefined), null);
});

test('filters by source, vetting, tells and unbuilt clips', () => {
  const f = DEFAULT_FILTER;
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(), { ...f, source: 'batch:real-2026-11-07' }, ORDER), ['b', 'c']);
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(['c']), { ...f, vetted: 'vetted' }, ORDER), ['c']);
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(['c']), { ...f, vetted: 'unvetted' }, ORDER), ['b', 'a']);
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(), { ...f, tells: 'without' }, ORDER), ['a']);
  assert.deepEqual(buildQueue(ITEMS, {}, new Set(), { ...f, unbuilt: true, source: 'batch:spot_test' }, ORDER), ['d']);
});

test('sourceOptions counts each clip once per source, in source order', () => {
  assert.deepEqual(sourceOptions(ITEMS, ORDER), [
    { id: 'feed:local/demo', label: 'local/demo', count: 2 },
    { id: 'batch:real-2026-11-07', label: 'real-2026-11-07', count: 2 },
    { id: 'batch:spot_test', label: 'spot_test', count: 1 },
  ]);
});

test('nextIndex moves on, and stays on the last clip at the end', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 2);
  assert.equal(nextIndex(0, 0), -1);
});

const tell = (id: string, t0: number, t1: number, focusT?: number): Tell => ({ id, category: 'x', label: id, t0, t1, focusT });

test('focusTime matches the app walkthrough', () => {
  for (const t of [tell('a', 1, 2), tell('b', 1, 1.2), tell('c', 1, 4, 3.5), tell('d', 2, 3, 9)]) assert.equal(focusTime(t), seekTimeFor(t));
});

test('markers place each lane’s tells on the clip, with a visible minimum width', () => {
  const m = markers([{ name: 'main', tells: [tell('a', 2, 4)] }, { name: 'claude', tells: [tell('b', 5, 5)] }], 10);
  assert.deepEqual({ ...m[0], at: +m[0].at.toFixed(6) }, { lane: 0, tell: 0, left: 0.2, width: 0.2, at: 0.23 });
  assert.equal(m[1].lane, 1);
  assert.ok(Math.abs(m[1].width - 0.008) < 1e-9);
  assert.ok(Math.abs(m[1].left + m[1].width / 2 - 0.5) < 1e-9);
  assert.deepEqual(markers([{ name: 'x', tells: [tell('a', 1, 2)] }], 0), []);
});

test('stepFrom walks tells by focus frame in both directions', () => {
  const ts = [tell('late', 6, 7), tell('early', 1, 2), tell('mid', 3, 5, 4)];
  assert.equal(stepFrom(ts, 0, 1)?.id, 'early');
  assert.equal(stepFrom(ts, focusTime(ts[1]), 1)?.id, 'mid');
  assert.equal(stepFrom(ts, 4, -1)?.id, 'early');
  assert.equal(stepFrom(ts, 9, 1), null);
  assert.equal(stepFrom(ts, 0, -1), null);
});

test('runLabel and clock', () => {
  assert.deepEqual(runLabel('main', ['nvidia/nemotron-3.5-super-vl-120b-a12b']), { name: 'shipped', model: 'nemotron-3.5-super-vl-120b-a12b' });
  assert.deepEqual(runLabel('claude', undefined), { name: 'claude', model: null });
  assert.equal(clock(7.42), '0:07.4');
  assert.equal(clock(65), '1:05.0');
  assert.equal(clock(NaN), '0:00.0');
});

test('tellRef builds keys the decisions log accepts', () => {
  assert.equal(tellRef('nemotron-dense', 'fingers-merge-with-seal'), 'nemotron-dense/fingers-merge-with-seal');
  for (const [run, id] of [['main', 'a b/c?'], ['we:ird', ''], ['claude', 'x'.repeat(300)]]) {
    const ref = tellRef(run, id);
    assert.equal(checkPatch({ tells: { [ref]: { pick: true } } }), null, ref);
  }
});
