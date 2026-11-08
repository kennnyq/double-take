import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryCoverage, clipCategories, skillCategoryOf } from './categories.ts';
import { priorDifficulty } from './difficulty.ts';
import { SKILL_PRIOR, freshSkills, generalSkill, pCorrect, recordAnswer, skillForClip, toScore, updateDifficulty, updateSkill } from './skill.ts';

test('tell categories roll up to the investigation components', () => {
  assert.equal(skillCategoryOf('anatomy'), 'subject');
  assert.equal(skillCategoryOf('garbled_text'), 'text');
  assert.equal(skillCategoryOf('physics'), 'visuals');
  assert.equal(skillCategoryOf('object appearing/disappearing'), 'visuals');
  assert.equal(skillCategoryOf('watermark'), 'provenance');
  assert.equal(skillCategoryOf('voice'), 'audio');
  assert.equal(skillCategoryOf(42), 'other');
});

test('a clip’s categories are weights summing to 1', () => {
  assert.deepEqual(clipCategories({ verdict: 'real', tellCategories: ['anatomy'] }), { real: 1 });
  assert.deepEqual(clipCategories({ verdict: 'ai' }), { other: 1 });
  assert.deepEqual(clipCategories({ verdict: 'ai', tellCategories: ['other'] }), { other: 1 });
  const c = clipCategories({ verdict: 'ai', tellCategories: ['anatomy', 'text', 'other'], claims: ['the voice is off', 'nothing here'] });
  assert.ok(!('other' in c), 'other only when nothing specific');
  assert.equal(c.subject, 1 / 2.5);
  assert.equal(c.audio, 0.5 / 2.5);
  assert.ok(Math.abs(Object.values(c).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(categoryCoverage([c, { real: 1 }]).subject, 1);
});

test('a right answer raises the skill, a wrong one lowers it, and each answer adds certainty', () => {
  const up = updateSkill(SKILL_PRIOR, 0, true);
  const down = updateSkill(SKILL_PRIOR, 0, false);
  assert.ok(up.mu > 0 && down.mu < 0);
  assert.ok(up.v < SKILL_PRIOR.v);
  assert.equal(up.n, 1);
  assert.equal(updateSkill(SKILL_PRIOR, 0, true, 0), SKILL_PRIOR);
});

test('surprises move a skill more than expected answers', () => {
  const easyRight = updateSkill(SKILL_PRIOR, -2, true).mu;
  const hardRight = updateSkill(SKILL_PRIOR, 2, true).mu;
  assert.ok(hardRight > easyRight * 3);
  const easyWrong = updateSkill(SKILL_PRIOR, -2, false).mu;
  const hardWrong = updateSkill(SKILL_PRIOR, 2, false).mu;
  assert.ok(Math.abs(easyWrong) > Math.abs(hardWrong) * 3);
});

test('difficulty moves the other way: a right answer makes a clip look easier', () => {
  const d = { mu: 0, v: 0.8, n: 0 };
  assert.ok(updateDifficulty(d, 0, true).mu < 0);
  assert.ok(updateDifficulty(d, 0, false).mu > 0);
});

test('scores: 50 is guessing; the band narrows with evidence', () => {
  assert.equal(toScore(SKILL_PRIOR).score, 50);
  let s = SKILL_PRIOR;
  for (let i = 0; i < 40; i++) s = updateSkill(s, 0, i % 4 !== 0);
  const t = toScore(s);
  assert.ok(t.score > 60, String(t.score));
  assert.ok(t.high - t.low < toScore(SKILL_PRIOR).high - toScore(SKILL_PRIOR).low);
});

test('the general score weights categories by evidence; empty ones count for nothing', () => {
  let skills = freshSkills();
  assert.equal(generalSkill(skills).mu, 0);
  for (let i = 0; i < 20; i++) skills = recordAnswer(skills, { subject: 1 }, 0, true);
  skills = recordAnswer(skills, { text: 1 }, 0, false);
  const g = generalSkill(skills);
  assert.ok(g.mu > 0, 'dominated by the well-measured category');
  assert.ok(g.mu < skills.subject.mu);
  assert.ok(skillForClip(skills, { subject: 0.5, text: 0.5 }) < skills.subject.mu);
});

test('difficulty priors: more and clearer tells are easier; vouched-for real footage is harder', () => {
  const ai = (o: object) => priorDifficulty({ verdict: 'ai', ...o });
  assert.ok(ai({ tells: 3 }) < ai({ tells: 1 }));
  assert.ok(ai({ tells: 1, highConfidence: 1 }) < ai({ tells: 1 }));
  assert.ok(ai({ tells: 1, textTells: 1 }) < ai({ tells: 1 }));
  assert.ok(ai({ tells: 0 }) > ai({ tells: 1 }));
  assert.ok(priorDifficulty({ verdict: 'real', tier: 'real-verified' }) > priorDifficulty({ verdict: 'real', tier: 'real-prior' }));
  for (const t of [0, 1, 9]) assert.ok(Math.abs(ai({ tells: t, highConfidence: 9, textTells: 9 })) <= 1.2);
  assert.ok(pCorrect(0, priorDifficulty({ verdict: 'real', tier: 'real-prior' })) > 0.5);
});
