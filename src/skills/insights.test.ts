import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MAX, MISSES_MAX, NO_STATS, addAnswer, milestones, pushHistory, pushMiss, weakestSkill } from './insights.ts';
import { freshSkills, SKILL_PRIOR } from './skill.ts';

test('streaks, best streak and AI caught come from the answers', () => {
  let s = NO_STATS;
  for (const a of [
    { correct: true, truth: 'ai' as const },
    { correct: true, truth: 'real' as const },
    { correct: true, truth: 'ai' as const },
    { correct: false, truth: 'ai' as const },
    { correct: true, truth: 'real' as const },
  ])
    s = addAnswer(s, a);
  assert.deepEqual({ ...s }, { answers: 5, correct: 4, aiCaught: 2, streak: 1, bestStreak: 3, rounds: 0 });
});

test('milestones are only the ones reached', () => {
  assert.deepEqual(milestones(NO_STATS), []);
  const ids = milestones({ ...NO_STATS, answers: 12, bestStreak: 6, aiCaught: 3 }).map((m) => m.id);
  assert.deepEqual(ids, ['judged-10', 'streak-5']);
});

test('the weakest skill needs a few answers and must be below the general score', () => {
  const skills = freshSkills();
  skills.subject = { mu: -1, v: 0.5, n: 5 };
  skills.text = { mu: -2, v: 0.5, n: 1 };
  skills.real = { mu: 1.5, v: 0.5, n: 9 };
  const overall = { ...SKILL_PRIOR };
  assert.equal(weakestSkill(skills, ['subject', 'text', 'real'], overall), 'subject', 'text has too few answers');
  assert.equal(weakestSkill(skills, ['real'], overall), null, 'nothing below the general score');
});

test('history and misses stay short', () => {
  let h: number[] = [];
  for (let i = 0; i < HISTORY_MAX + 5; i++) h = pushHistory(h, i);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[h.length - 1], HISTORY_MAX + 4);
  let m = {};
  for (let i = 0; i < 6; i++) m = pushMiss(m, `k${i}`, { subject: 1 });
  m = pushMiss(m, 'k3', { subject: 0.5, text: 0.5 });
  assert.deepEqual((m as Record<string, string[]>).subject, ['k3', 'k5', 'k4', 'k2'].slice(0, MISSES_MAX));
  assert.deepEqual((m as Record<string, string[]>).text, ['k3']);
});
