import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceDisplay,
  countChanged,
  createDevRegistry,
  findRow,
  resetRows,
  resolveTabs,
  rowChanged,
  rowKey,
  searchTabs,
  stepValue,
  type DevChoiceRow,
  type DevRow,
} from './registry.ts';

type Ctx = { size: string };
const flush = () => new Promise<void>((r) => queueMicrotask(r));

function choice(value: string, set: (v: string) => void = () => {}, extra: Partial<DevChoiceRow> = {}): DevChoiceRow {
  return {
    kind: 'choice',
    label: 'Size',
    items: [
      { label: 'Small', value: 's' },
      { label: 'Medium', value: 'm' },
      { label: 'Large', value: 'l' },
    ],
    value,
    defaultValue: 'm',
    onSelect: (v) => set(String(v)),
    ...extra,
  };
}

test('tabs and sections come out in order, and a tab with nothing on it is hidden', () => {
  const r = createDevRegistry<Ctx>();
  r.registerTab({ id: 'b', label: 'B', icon: 'x', order: 20 });
  r.registerTab({ id: 'a', label: 'A', icon: 'x', order: 10 });
  r.registerTab({ id: 'empty', label: 'Empty', icon: 'x', order: 5 });
  r.registerSection({ id: 'b2', tab: 'b', title: 'Second', order: 1, rows: [choice('m')] });
  r.registerSection({ id: 'b1', tab: 'b', title: 'First', rows: [choice('m')] });
  r.registerSection({ id: 'a1', tab: 'a', title: 'Only', rows: [choice('m')] });
  const tabs = resolveTabs(r.getSnapshot(), { size: 'm' });
  assert.deepEqual(tabs.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(tabs[1].sections.map((s) => s.id), ['b1', 'b2']);
});

test('rows can be worked out from the settings, and are counted when changed', () => {
  const r = createDevRegistry<Ctx>();
  r.registerTab({ id: 't', label: 'T', icon: 'x', order: 1 });
  r.registerSection({ id: 's', tab: 't', rows: (ctx) => [choice(ctx.size)] });
  assert.equal(resolveTabs(r.getSnapshot(), { size: 'm' })[0].changed, 0);
  assert.equal(resolveTabs(r.getSnapshot(), { size: 'l' })[0].changed, 1);
});

test('a section with only a view of its own still shows its tab', () => {
  const r = createDevRegistry<Ctx>();
  r.registerTab({ id: 't', label: 'T', icon: 'x', order: 1 });
  r.registerSection({ id: 'v', tab: 't', Component: () => null });
  assert.equal(resolveTabs(r.getSnapshot(), { size: 'm' }).length, 1);
});

test('registering an id again replaces it in place, and only the live registration unregisters', async () => {
  const r = createDevRegistry<Ctx>();
  let publishes = 0;
  r.subscribe(() => publishes++);
  r.registerTab({ id: 't', label: 'T', icon: 'x', order: 1 });
  r.registerSection({ id: 'one', tab: 't', title: 'One', rows: [] });
  const offOld = r.registerSection({ id: 'two', tab: 't', title: 'Old', rows: [] });
  const offNew = r.registerSection({ id: 'two', tab: 't', title: 'New', rows: [] });
  assert.deepEqual(r.getSnapshot().sections.map((s) => s.title), ['One', 'New']);

  offOld(); // a stale cleanup (as between two renders) leaves the new one
  await flush();
  assert.deepEqual(r.getSnapshot().sections.map((s) => s.title), ['One', 'New']);

  offNew();
  await flush();
  assert.deepEqual(r.getSnapshot().sections.map((s) => s.title), ['One']);
  assert.ok(publishes >= 5);
});

test('stepValue wraps round both ends, and starts at an end from an unknown value', () => {
  const items = choice('m').items;
  assert.equal(stepValue(items, 'm', 1), 'l');
  assert.equal(stepValue(items, 'l', 1), 's');
  assert.equal(stepValue(items, 's', -1), 'l');
  assert.equal(stepValue(items, 'zz', 1), 's');
  assert.equal(stepValue(items, 'zz', -1), 'l');
  assert.equal(stepValue([], 'm', 1), 'm');
});

test('rowChanged needs a default; resetRows puts changed rows back', () => {
  const picks: string[] = [];
  const flips: boolean[] = [];
  const rows: DevRow[] = [
    choice('l', (v) => picks.push(v)),
    choice('m', (v) => picks.push(v)),
    choice('s', (v) => picks.push(v), { defaultValue: undefined }),
    { kind: 'switch', label: 'On', value: true, defaultValue: false, onChange: (v) => flips.push(v) },
    { kind: 'action', label: 'Go', run: () => {} },
  ];
  assert.deepEqual(rows.map(rowChanged), [true, false, false, true, false]);
  assert.equal(countChanged(rows), 2);
  resetRows(rows);
  assert.deepEqual(picks, ['m']);
  assert.deepEqual(flips, [false]);
});

test('choiceDisplay: chips for a few short choices, a stepper otherwise, unless the row says', () => {
  assert.equal(choiceDisplay(choice('m')), 'chips');
  const many = choice('m', undefined, { items: ['a', 'b', 'c', 'd', 'e'].map((v) => ({ label: v, value: v })) });
  assert.equal(choiceDisplay(many), 'stepper');
  const long = choice('m', undefined, { items: [{ label: 'A rather long label', value: 1 }, { label: 'Another long one', value: 2 }] });
  assert.equal(choiceDisplay(long), 'stepper');
  assert.equal(choiceDisplay({ ...many, display: 'chips' }), 'chips');
});

test('findRow finds a row by its key; search matches rows, or a whole section by its title', () => {
  const r = createDevRegistry<Ctx>();
  r.registerTab({ id: 't', label: 'Look', icon: 'x', order: 1 });
  r.registerSection({
    id: 'sec',
    tab: 't',
    title: 'Palette',
    rows: [choice('m', undefined, { id: 'size' }), { kind: 'action', label: 'Reset everything', run: () => {} }],
  });
  const tabs = resolveTabs(r.getSnapshot(), { size: 'm' });
  const hit = findRow(tabs, 'sec/size');
  assert.equal(hit?.row.label, 'Size');
  assert.equal(rowKey('sec', { kind: 'action', label: 'Go', run: () => {} }), 'sec/Go');
  assert.equal(findRow(tabs, 'sec/nope'), null);

  assert.deepEqual(searchTabs(tabs, 'large').map((h) => h.rows.map((r) => r.label)), [['Size']]);
  assert.equal(searchTabs(tabs, 'palette')[0].rows.length, 2);
  assert.equal(searchTabs(tabs, 'reset every')[0].rows[0].label, 'Reset everything');
  assert.deepEqual(searchTabs(tabs, 'nothing here'), []);
  assert.deepEqual(searchTabs(tabs, '   '), []);
});
