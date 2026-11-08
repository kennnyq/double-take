import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS_KEY, applyRound, createSkillStore, difficultyOf, emptySkillState, parseSkillState } from './state.ts';

function kv() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('a round updates the categories it touched and the clips’ difficulty', () => {
  const s = applyRound(emptySkillState(), [
    { key: 'a', correct: true, cats: { subject: 1 }, prior: 0.5 },
    { key: 'b', correct: false, cats: { real: 1 }, prior: 0 },
  ]);
  assert.ok(s.skills.subject.mu > 0);
  assert.ok(s.skills.real.mu < 0);
  assert.equal(s.skills.text.n, 0);
  assert.ok(difficultyOf(s, 'a', 0.5) < 0.5, 'answered right: looks easier');
  assert.ok(difficultyOf(s, 'b', 0) > 0);
  assert.equal(difficultyOf(s, 'zzz', 0.3), 0.3);
  assert.equal(s.answers, 2);
  assert.equal(s.rounds, 1);
});

test('kept on the device; corrupt storage starts over', () => {
  const k = kv();
  const store = createSkillStore(k);
  const { before, after } = store.recordRound([{ key: 'a', correct: true, cats: { text: 1 }, prior: 0 }]);
  assert.equal(before.text.n, 0);
  assert.equal(after.text.n, 1);
  assert.deepEqual(createSkillStore(k).getSnapshot(), store.getSnapshot());
  store.rememberCategories(new Map([['z', { visuals: 1 }]]));
  assert.deepEqual(createSkillStore(k).getSnapshot().cats.z, { visuals: 1 });
  k.m.set(SKILLS_KEY, '{"skills":{"text":{"mu":"x"}}, "clips": {"q": {"mu": 1, "v": -1, "n": 0}}}');
  const parsed = createSkillStore(k).getSnapshot();
  assert.equal(parsed.skills.text.mu, 0);
  assert.equal(parsed.clips.q, undefined);
  assert.deepEqual(parseSkillState('nope'), emptySkillState());
  store.reset();
  assert.equal(store.getSnapshot().answers, 0);
});
