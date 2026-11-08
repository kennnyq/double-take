import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipCounts, facetValues, filterItems, groupItems, sortItems, type LibraryCtx, type LibraryItem } from './library.ts';

const media = (tells: number, duration = 10) => ({ duration, tells: Array.from({ length: tells }, (_, i) => ({ name: `r${i}`, url: 'u' })) });
const feed = (index: number) => ({ kind: 'feed' as const, source: 'prod', name: 'demo', index });
const batch = (name: string, index: number) => ({ kind: 'batch' as const, name, index });

const ITEMS: LibraryItem[] = [
  { key: 'a', kind: 'ai', in: [feed(0)], media: media(3, 12), date: 3, author: 'Stella' },
  { key: 'b', kind: 'real', in: [feed(1), batch('real-2026-11-07', 0)], media: media(0, 40), date: 1 },
  { key: 'c', kind: 'ai', in: [feed(2)], media: media(1, 8), date: 2 },
  { key: 'd', kind: 'ai', in: [batch('spot_test', 0)], media: null },
];
const ctx: LibraryCtx = {
  states: {
    a: { status: 'keep', by: 'kenny', at: '2026-11-08T02', tells: { 'main/x': { pick: true, note: '' } } },
    b: { status: 'keep', by: 'worker-vetted', at: '2026-11-08T01', note: 'Vetted by the harvest worker' },
    c: { status: 'discard', by: 'kenny', at: '2026-11-08T03', note: 'mushy' },
  },
  vetted: new Set(['b']),
  tellStats: new Map([
    ['a', { count: 4, categories: ['anatomy', 'physics'] }],
    ['c', { count: 1, categories: ['text'] }],
  ]),
};
const F = { q: '', chips: {}, unbuilt: false };

test('facets: decision, reviewer, kind, sources, tell counts and categories, marks', () => {
  assert.deepEqual(facetValues(ITEMS[0], ctx), {
    source: ['prod/demo'],
    kind: ['AI'],
    status: ['Kept'],
    reviewer: ['Reviewed by kenny'],
    tells: ['3–5 tells'],
    category: ['anatomy', 'physics'],
    eyes: [],
    marks: ['★ Picked tells'],
  });
  const b = facetValues(ITEMS[1], ctx);
  assert.deepEqual([b.reviewer, b.tells, b.source], [['Worker-vetted'], ['No tells'], ['prod/demo', 'real-2026-11-07']]);
  assert.deepEqual(b.marks, [], 'the worker’s vetting note is not a reviewer note');
  assert.deepEqual(facetValues(ITEMS[2], ctx).marks, ['Has notes']);
  assert.deepEqual(facetValues(ITEMS[3], ctx).tells, ['Not built']);
});

test('filters AND across facets, OR within one, search notes too, and hide unbuilt clips by default', () => {
  assert.deepEqual(filterItems(ITEMS, ctx, F).map((i) => i.key), ['a', 'b', 'c']);
  assert.deepEqual(filterItems(ITEMS, ctx, { ...F, unbuilt: true }).map((i) => i.key), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterItems(ITEMS, ctx, { ...F, chips: { kind: ['AI'], status: ['Kept', 'Dropped'] } }).map((i) => i.key), ['a', 'c']);
  assert.deepEqual(filterItems(ITEMS, ctx, { ...F, chips: { reviewer: ['Worker-vetted'] } }).map((i) => i.key), ['b']);
  assert.deepEqual(filterItems(ITEMS, ctx, { ...F, q: 'mushy' }).map((i) => i.key), ['c']);
});

test('groups in a fixed order where one makes sense; a clip in two sources is in both', () => {
  const g = groupItems(filterItems(ITEMS, ctx, F), ctx, 'status');
  assert.deepEqual(g, [
    { title: 'Kept', keys: ['a', 'b'] },
    { title: 'Dropped', keys: ['c'] },
  ]);
  const s = groupItems(filterItems(ITEMS, ctx, F), ctx, 'source');
  assert.deepEqual(s.map((x) => [x.title, x.keys]), [['prod/demo', ['a', 'b', 'c']], ['real-2026-11-07', ['b']]]);
  assert.deepEqual(groupItems(ITEMS, ctx, 'none')[0].keys, ['a', 'b', 'c', 'd']);
});

test('sorts by date, duration, tells and review time, falling back to feed order', () => {
  const order = ['feed:prod/demo', 'batch:real-2026-11-07', 'batch:spot_test'];
  const keys = (by: Parameters<typeof sortItems>[2]) => sortItems(ITEMS, ctx, by, order).map((i) => i.key);
  assert.deepEqual(keys('queue'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(keys('newest'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(keys('long'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(keys('tells'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(keys('reviewed'), ['c', 'a', 'b', 'd']);
});

test('chip counts ignore their own facet’s selection', () => {
  const c = chipCounts(ITEMS, ctx, { ...F, chips: { kind: ['Real'] } }, ['kind', 'status']);
  assert.deepEqual(c.kind, [['AI', 2], ['Real', 1]]);
  assert.deepEqual(c.status, [['Kept', 1]]);
});
