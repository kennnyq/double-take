import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng } from '../game/deck.ts';
import { buildAdaptiveDeck, suitability, weightedPick } from '../game/adaptive.ts';
import { freshSkills } from './skill.ts';
import { simulate, type SimClip } from './simulate.ts';

/** A pool like the feed's: AI clips across categories and real clips, with spread difficulties. */
function pool(n = 160, seed = 1, range = 4): SimClip[] {
  const rng = seededRng(seed);
  const cats = ['subject', 'text', 'visuals', 'other'] as const;
  return Array.from({ length: n }, (_, i) => {
    const real = i % 3 === 0;
    const prior = (rng() - 0.5) * range;
    return {
      id: `c${i}`,
      verdict: real ? 'real' : 'ai',
      aspect: 0.56,
      cats: real ? { real: 1 } : { [cats[i % cats.length]]: 1 },
      prior,
      trueDifficulty: prior + (rng() - 0.5) * 0.8,
    } as SimClip;
  });
}

test('weighted picks: no repeats, heavier items first more often, uniform when exploring fully', () => {
  const rng = seededRng(2);
  const items = [1, 2, 3, 4, 5, 6];
  const once = weightedPick(items, (x) => x, 6, rng, 0);
  assert.deepEqual([...once].sort(), items);
  let first6 = 0;
  for (let i = 0; i < 400; i++) if (weightedPick(items, (x) => (x === 6 ? 50 : 1), 1, rng, 0)[0] === 6) first6++;
  assert.ok(first6 > 300);
  let explored = 0;
  for (let i = 0; i < 600; i++) if (weightedPick(items, (x) => (x === 6 ? 1e9 : 1), 1, rng, 1)[0] !== 6) explored++;
  assert.ok(explored > 400);
});

test('suitability peaks at the target and prefers fresh portrait clips', () => {
  const o = { target: 0.65, spread: 0.12, recent: false, portrait: true };
  assert.ok(suitability(0.65, o) > suitability(0.9, o));
  assert.ok(suitability(0.65, o) > suitability(0.4, o));
  assert.ok(suitability(0.65, { ...o, recent: true }) < suitability(0.65, o));
  assert.ok(suitability(0.65, { ...o, portrait: false }) < suitability(0.65, o));
});

test('the adaptive deck stays half AI, half real, and aims near the target', () => {
  const clips = pool(160, 1, 2.4).map((c) => ({ ...c, difficulty: c.prior }));
  const deck = buildAdaptiveDeck(clips, { skills: freshSkills(), rng: seededRng(4), cap: 30, explore: 0 });
  assert.equal(deck.length, 30);
  assert.equal(deck.filter((c) => c.truth === 'ai').length, 15);
  const meanP = deck.reduce((a, c) => a + c.p, 0) / deck.length;
  assert.ok(Math.abs(meanP - 0.65) < 0.08, String(meanP));
});

test('the estimate finds a strong bot’s true score, and adaptive dealing holds it near the target success rate', () => {
  // A catalog several times today's: with ~50 real clips there are too few hard ones to aim at.
  const p = pool(800);
  const opts = { base: 1.6, rounds: 40, perRound: 24, seed: 11 };
  const shuffled = simulate(p, { ...opts, adaptive: false });
  const adaptive = simulate(p, { ...opts, adaptive: true });
  const last = shuffled[shuffled.length - 1];
  assert.ok(Math.abs(last.estimate - last.truth) <= 10, `${last.estimate} vs ${last.truth}`);
  const tail = (rs: typeof shuffled) => rs.slice(-15).reduce((a, r) => a + r.success, 0) / 15;
  // A strong player breezes through a random deck; adaptive dealing pulls success toward the target.
  assert.ok(tail(shuffled) > 0.75, String(tail(shuffled)));
  assert.ok(Math.abs(tail(adaptive) - 0.65) < Math.abs(tail(shuffled) - 0.65) - 0.05, `${tail(adaptive)} vs ${tail(shuffled)}`);
  const dealt = (rs: typeof shuffled) => rs.slice(-15).reduce((a, r) => a + r.dealt, 0) / 15;
  assert.ok(dealt(adaptive) > dealt(shuffled), 'harder clips for a strong player');
});

test('a weak bot gets easier clips than a strong one', () => {
  const p = pool(800);
  const weak = simulate(p, { base: -0.6, rounds: 30, perRound: 24, adaptive: true, seed: 5 });
  const strong = simulate(p, { base: 1.6, rounds: 30, perRound: 24, adaptive: true, seed: 5 });
  const dealt = (rs: typeof weak) => rs.slice(-10).reduce((a, r) => a + r.dealt, 0) / 10;
  assert.ok(dealt(weak) < dealt(strong));
  assert.ok(weak[weak.length - 1].estimate < strong[strong.length - 1].estimate);
});
