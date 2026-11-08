import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_SIGNALS, addEvent, affinities, engagement, rankFeed, scoreClip, type ClipSignals, type RankInput } from './rank.ts';

const now = 1_000_000_000_000;
const clip = (key: string, ...features: string[]): RankInput => ({ key, features, likes: 0 });

test('events fold into signals; engagement weighs likes over skips', () => {
  let s: ClipSignals = NO_SIGNALS;
  s = addEvent(s, { kind: 'view', watched: 0.95 }, now);
  s = addEvent(s, { kind: 'like' }, now);
  s = addEvent(s, { kind: 'answer', correct: false }, now);
  assert.equal(s.views, 1);
  assert.equal(s.completions, 1);
  assert.equal(s.missed, 1);
  assert.equal(s.lastSeen, now);
  assert.ok(engagement(s) > 0);
  assert.ok(engagement(addEvent(NO_SIGNALS, { kind: 'skip' }, now)) < 0);
});

test('affinity: features of liked clips go up, of skipped clips down, shrunk while unproven', () => {
  const items = [clip('a', 'cat:subject'), clip('b', 'cat:subject'), clip('c', 'cat:text'), clip('d', 'cat:visuals')];
  const sig: Record<string, ClipSignals> = {
    a: addEvent(NO_SIGNALS, { kind: 'like' }, now),
    b: addEvent(NO_SIGNALS, { kind: 'like' }, now),
    c: addEvent(NO_SIGNALS, { kind: 'skip' }, now),
  };
  const aff = affinities(items, (k) => sig[k] ?? NO_SIGNALS);
  assert.ok(aff.get('cat:subject')! > 0);
  assert.ok(aff.get('cat:text')! < 0);
  assert.equal(aff.has('cat:visuals'), false);
  assert.ok(aff.get('cat:subject')! < 3, 'shrunk below one like');
});

test('unseen clips get novelty; seen ones fatigue, less as time passes', () => {
  const it = clip('x');
  const fresh = scoreClip(it, NO_SIGNALS, new Map(), { now });
  const seen = addEvent(NO_SIGNALS, { kind: 'view', watched: 0.3 }, now);
  const justNow = scoreClip(it, seen, new Map(), { now });
  const later = scoreClip(it, seen, new Map(), { now: now + 3 * 24 * 3600 * 1000 });
  assert.ok(fresh.score > later.score && later.score > justNow.score);
  assert.equal(fresh.reasons[0].why, 'new to you');
});

test('the ranker puts more of what you engage with first, explains why, and explores', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => clip(`s${i}`, 'cat:subject')),
    ...Array.from({ length: 10 }, (_, i) => clip(`t${i}`, 'cat:text')),
  ];
  const sig: Record<string, ClipSignals> = {};
  for (let i = 0; i < 3; i++) sig[`s${i}`] = addEvent(addEvent(NO_SIGNALS, { kind: 'view', watched: 1 }, now - 9e9), { kind: 'like' }, now - 9e9);
  for (let i = 0; i < 3; i++) sig[`t${i}`] = addEvent(addEvent(NO_SIGNALS, { kind: 'view', watched: 0.05 }, now - 9e9), { kind: 'skip' }, now - 9e9);
  const ranked = rankFeed(items, (c) => c, (k) => sig[k] ?? NO_SIGNALS, { now, label: (f) => f.replace('cat:', ''), exploreEvery: 5, seed: 2 });
  assert.equal(ranked.length, 20);
  const top = ranked.slice(0, 8).filter((r) => !r.explored);
  assert.ok(top.every((r) => r.clip.key.startsWith('s')), top.map((r) => r.clip.key).join());
  assert.ok(ranked[4].explored && ranked[9].explored);
  assert.ok(ranked[0].reasons.some((r) => r.why === 'you engage with subject'));
  assert.equal(new Set(ranked.map((r) => r.clip.key)).size, 20);
  const plain = rankFeed(items, (c) => c, (k) => sig[k] ?? NO_SIGNALS, { now, exploreEvery: 0 });
  assert.ok(plain.every((r) => !r.explored));
});

test('the signal store keeps events per clip on the device', async () => {
  const { createSignalStore } = await import('./signals.ts');
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const a = createSignalStore(kv);
  a.note('x', { kind: 'like' }, now);
  a.note('x', { kind: 'answer', correct: false }, now);
  const b = createSignalStore(kv);
  assert.equal(b.get('x').likes, 1);
  assert.equal(b.get('x').missed, 1);
  assert.equal(b.get('nope').views, 0);
});

test('a simulated viewer: the ranker learns their taste and beats a random order', async () => {
  const { simulateViewer } = await import('./simulate.ts');
  const items: RankInput[] = Array.from({ length: 120 }, (_, i) => ({
    key: `k${i}`,
    features: [i % 3 === 0 ? 'verdict:real' : 'verdict:ai', `cat:${['subject', 'text', 'visuals', 'other'][i % 4]}`],
    likes: (i * 37) % 1000,
  }));
  const r = simulateViewer(items, { taste: { 'cat:subject': 1, 'verdict:real': -0.5 }, sessions: 8, perSession: 15, seed: 4 });
  const first = r.sessions[0];
  const late = r.sessions.slice(-3).reduce((n, s) => n + s.precision, 0) / 3;
  const base = r.sessions.reduce((n, s) => n + s.baseline, 0) / r.sessions.length;
  assert.ok(late > base + 0.3, `${late} vs ${base}`);
  assert.ok(late > first.precision);
  assert.ok(r.last.some((x) => x.explored), 'still explores');
});
