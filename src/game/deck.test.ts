import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, clipKey, deckPlayable, kindCounts, seededRng, shuffle, type DeckSource } from './deck.ts';

function clips(ai: number, real: number, extra: Partial<DeckSource>[] = []): DeckSource[] {
  const out: DeckSource[] = [];
  for (let i = 0; i < ai; i++) out.push({ id: `clip-${out.length}`, sourceId: `ai-${i}`, verdict: 'ai' });
  for (let i = 0; i < real; i++) out.push({ id: `clip-${out.length}`, sourceId: `real-${i}`, verdict: 'real' });
  return [...out, ...extra.map((e, i) => ({ id: `extra-${i}`, ...e }))];
}

test('half AI, half real, capped', () => {
  const deck = buildDeck(clips(31, 51), { rng: seededRng(1) });
  assert.equal(deck.length, 60);
  assert.equal(deck.filter((c) => c.truth === 'ai').length, 30);
  assert.equal(deck.filter((c) => c.truth === 'real').length, 30);
  const small = buildDeck(clips(12, 40), { rng: seededRng(1) });
  assert.equal(small.length, 24);
  assert.equal(buildDeck(clips(31, 51), { rng: seededRng(1), cap: 9 }).length, 8);
});

test('placeholders and repeats are left out', () => {
  const deck = buildDeck(clips(3, 3, [{}, {}, { sourceId: 'ai-0', verdict: 'ai' }]), { rng: seededRng(2) });
  assert.equal(deck.length, 6);
  assert.equal(new Set(deck.map((c) => clipKey(c.clip))).size, 6);
});

test('a feed with only one kind still deals (dev data)', () => {
  const deck = buildDeck(clips(5, 0), { rng: seededRng(3) });
  assert.equal(deck.length, 5);
  assert.ok(deck.every((c) => c.truth === 'ai'));
  assert.equal(buildDeck([], {}).length, 0);
});

test('clips from recent rounds come last', () => {
  const all = clips(10, 10);
  const recent = ['ai-0', 'ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5', 'real-0', 'real-1'];
  const deck = buildDeck(all, { rng: seededRng(4), recent, cap: 8 });
  assert.equal(deck.length, 8);
  assert.ok(deck.every((c) => !recent.includes(clipKey(c.clip))), 'only fresh clips');
  // Not enough fresh AI clips: recent ones fill in.
  const tight = buildDeck(all, { rng: seededRng(4), recent, cap: 12 });
  const recentUsed = tight.filter((c) => recent.includes(clipKey(c.clip)));
  assert.equal(recentUsed.length, 2);
  assert.ok(recentUsed.every((c) => c.truth === 'ai'));
});

test('a seed gives the same deck; another seed a different one', () => {
  const all = clips(20, 20);
  const a = buildDeck(all, { rng: seededRng(7) }).map((c) => c.id);
  const b = buildDeck(all, { rng: seededRng(7) }).map((c) => c.id);
  const c = buildDeck(all, { rng: seededRng(8) }).map((c) => c.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('shuffle keeps every item', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(
    shuffle(items, seededRng(9)).sort((x, y) => x - y),
    items,
  );
});

test('playable only with enough of each kind', () => {
  assert.deepEqual(kindCounts(clips(3, 2, [{}])), { ai: 3, real: 2 });
  assert.equal(deckPlayable(clips(8, 8)), true);
  assert.equal(deckPlayable(clips(119, 0)), false);
  assert.equal(deckPlayable(clips(8, 7)), false);
  assert.equal(deckPlayable(clips(2, 2), 2), true);
});

test('portrait clips are dealt before landscape ones', () => {
  const all: DeckSource[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `ap${i}`, verdict: 'ai' as const, aspect: 9 / 16 })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `al${i}`, verdict: 'ai' as const, aspect: 16 / 9 })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `rp${i}`, verdict: 'real' as const, aspect: 0.5 })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `rl${i}`, verdict: 'real' as const, aspect: 1.5 })),
  ];
  const deck = buildDeck(all, { rng: seededRng(5), cap: 12 });
  const ai = deck.filter((c) => c.truth === 'ai');
  const real = deck.filter((c) => c.truth === 'real');
  assert.ok(ai.every((c) => c.id.startsWith('ap')), 'six portrait AI clips fill the AI half');
  assert.equal(real.filter((c) => c.id.startsWith('rp')).length, 3, 'every portrait real clip');
  assert.equal(real.length, 6, 'landscape fills the rest');
  // Portrait beats freshness: a recent portrait clip comes before a fresh landscape one.
  const again = buildDeck(all, { rng: seededRng(5), cap: 2, recent: ['ap0', 'ap1', 'ap2', 'ap3', 'ap4', 'ap5'] });
  assert.ok(again.find((c) => c.truth === 'ai')!.id.startsWith('ap'));
});

test('untimed quality order survives dealing; fresh clips stay ahead of recent ones', () => {
  const clips = Array.from({ length: 8 }, (_, i) => ({ id: `clip-${i}`, sourceId: `source-${i}`, verdict: i % 2 ? 'real' as const : 'ai' as const, aspect: 9 / 16 }));
  assert.deepEqual(buildDeck(clips, { cap: 4, preserveOrder: true }).map((c) => c.clip), clips.slice(0, 4));
  assert.deepEqual(buildDeck(clips, { cap: 4, preserveOrder: true, recent: ['source-0', 'source-1'] }).map((c) => c.clip), clips.slice(2, 6));
});
