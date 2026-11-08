import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from './config.ts';
import { HISTORY_KEY, addRound, createHistoryStore, parseHistory, recentClipKeys, type RoundSummary } from './history.ts';

const summary = (score: number, endedAt = 1): RoundSummary => ({
  endedAt,
  score,
  judged: 10,
  accuracy: 0.7,
  hits: score,
  aiSeen: 5,
  falseAlarms: 0,
  durationMs: 60_000,
});

function fakeKv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test('missing or corrupt storage starts empty', () => {
  for (const raw of [null, '', 'not json', '[]', '{"rounds":"x"}']) {
    assert.deepEqual(parseHistory(raw), { best: 0, rounds: [], recentDecks: [] }, String(raw));
  }
});

test('records rounds, newest first, and the best score', () => {
  const kv = fakeKv();
  const store = createHistoryStore(kv);
  assert.equal(store.record(summary(4, 1), ['a', 'b']).newBest, true);
  assert.equal(store.record(summary(2, 2), ['c']).newBest, false);
  assert.equal(store.record(summary(4, 3), ['d']).newBest, false);
  const h = store.getSnapshot();
  assert.equal(h.best, 4);
  assert.deepEqual(
    h.rounds.map((r) => r.endedAt),
    [3, 2, 1],
  );
  // Survives a reload.
  assert.deepEqual(createHistoryStore(kv).getSnapshot(), h);
  assert.ok(kv.data.has(HISTORY_KEY));
});

test('keeps only the recent decks and the last rounds', () => {
  let h = parseHistory(null);
  for (let i = 0; i < GAME.historyLimit + 5; i++) h = addRound(h, summary(i, i), [`clip-${i}`]).history;
  assert.equal(h.rounds.length, GAME.historyLimit);
  assert.equal(h.recentDecks.length, GAME.recentRounds);
  const last = GAME.historyLimit + 4;
  assert.ok(recentClipKeys(h).has(`clip-${last}`));
  assert.ok(!recentClipKeys(h).has(`clip-${last - GAME.recentRounds}`));
});

test('notifies listeners and clears', () => {
  const store = createHistoryStore(fakeKv());
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.record(summary(1), []);
  store.clear();
  off();
  store.record(summary(1), []);
  assert.equal(calls, 2);
});

test('blocked storage still works for the session', () => {
  const store = createHistoryStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  store.record(summary(3), []);
  assert.equal(store.getSnapshot().best, 3);
  assert.equal(createHistoryStore(null).getSnapshot().best, 0);
});
