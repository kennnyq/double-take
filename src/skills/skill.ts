/**
 * Skill and difficulty on one logistic scale (Rasch / Elo): a player with
 * ability θ gets a clip of difficulty b right with probability σ(θ − b).
 *
 * Each ability and each clip's difficulty is a Gaussian belief (mean, variance).
 * An answer updates both with the one-step Laplace approximation of Bayesian
 * logistic regression (as in Glicko or TrueSkill-lite):
 *
 *   p   = σ(μθ − μb)
 *   vθ' = 1 / (1/vθ + w·p(1−p))        μθ' = μθ + vθ'·w·(y − p)
 *   vb' = 1 / (1/vb + p(1−p))          μb' = μb − vb'·(y − p)
 *
 * so a surprise moves a belief more than an expected answer, an uncertain
 * belief moves more than a settled one, and certainty grows with evidence.
 * `w` (0..1) is how much the clip is about this category. Pure, for `node --test`.
 */
import { SKILL_CATEGORIES, type SkillCategory } from './categories.ts';

export interface Belief {
  mu: number;
  /** Variance. */
  v: number;
  /** Answers that informed it (weighted). */
  n: number;
}

/** A newcomer: average ability, wide uncertainty. */
export const SKILL_PRIOR: Readonly<Belief> = Object.freeze({ mu: 0, v: 1.5, n: 0 });
/** Variance never shrinks below this, so a skill can still move as a player improves. */
const MIN_VAR = 0.04;

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Chance of a right answer. */
export function pCorrect(theta: number, b: number): number {
  return sigmoid(theta - b);
}

/** One answer's update to an ability belief, weighted by how much the clip is about it. */
export function updateSkill(s: Belief, b: number, correct: boolean, w = 1): Belief {
  if (w <= 0) return s;
  const p = pCorrect(s.mu, b);
  const v = Math.max(MIN_VAR, 1 / (1 / s.v + w * p * (1 - p)));
  return { mu: s.mu + v * w * ((correct ? 1 : 0) - p), v, n: s.n + w };
}

/** The same answer's update to the clip's difficulty belief (a right answer makes it look easier). */
export function updateDifficulty(d: Belief, theta: number, correct: boolean): Belief {
  const p = pCorrect(theta, d.mu);
  const v = Math.max(MIN_VAR, 1 / (1 / d.v + p * (1 - p)));
  return { mu: d.mu - v * ((correct ? 1 : 0) - p), v, n: d.n + 1 };
}

/**
 * A 0–100 score: the chance of getting an average clip (difficulty 0) right,
 * with a band of ±1 standard deviation. Readers see 50 as guessing.
 */
export function toScore(s: Belief): { score: number; low: number; high: number } {
  const sd = Math.sqrt(s.v);
  return { score: Math.round(100 * sigmoid(s.mu)), low: Math.round(100 * sigmoid(s.mu - sd)), high: Math.round(100 * sigmoid(s.mu + sd)) };
}

export type Skills = Record<SkillCategory, Belief>;

export function freshSkills(): Skills {
  return Object.fromEntries(SKILL_CATEGORIES.map((c) => [c, { ...SKILL_PRIOR }])) as Skills;
}

/**
 * The general ability: the categories' means weighted by the evidence each
 * holds (precision gained over the prior), so a category with no answers
 * counts for nothing and a well-measured one counts most. Its variance is
 * the weighted average's, shrinking as evidence builds.
 */
export function generalSkill(skills: Skills, only?: readonly SkillCategory[]): Belief {
  let wSum = 0;
  let muSum = 0;
  let n = 0;
  for (const c of only ?? SKILL_CATEGORIES) {
    const s = skills[c];
    const w = Math.max(0, 1 / s.v - 1 / SKILL_PRIOR.v);
    wSum += w;
    muSum += w * s.mu;
    n += s.n;
  }
  if (wSum <= 0) return { ...SKILL_PRIOR };
  return { mu: muSum / wSum, v: 1 / (1 / SKILL_PRIOR.v + wSum), n };
}

/** A clip's ability to test against: the player's skill in the clip's categories, weighted. */
export function skillForClip(skills: Skills, cats: Partial<Record<SkillCategory, number>>): number {
  let w = 0;
  let mu = 0;
  for (const [c, x] of Object.entries(cats) as [SkillCategory, number][]) {
    w += x;
    mu += x * skills[c].mu;
  }
  return w > 0 ? mu / w : generalSkill(skills).mu;
}

/** Updates every category the clip is about, by its weight. */
export function recordAnswer(skills: Skills, cats: Partial<Record<SkillCategory, number>>, b: number, correct: boolean): Skills {
  const next = { ...skills };
  for (const [c, w] of Object.entries(cats) as [SkillCategory, number][]) next[c] = updateSkill(skills[c], b, correct, w);
  return next;
}
