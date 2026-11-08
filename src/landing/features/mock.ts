/**
 * The showcase's demo data, in the app's own models: a player's skills as
 * the Skills tab keeps them (`src/skills/skill.ts` beliefs, read back with
 * its `toScore`), and a short round's calls. The landing shows what a player
 * a few rounds in would see, not the visitor's own (empty) state.
 *
 * Pure, so it runs under `node --test`.
 */
import { SKILL_CATEGORIES, type SkillCategory } from '../../skills/categories.ts';
import { SKILL_PRIOR, type Belief, type Skills } from '../../skills/skill.ts';

const logit = (p: number) => Math.log(p / (1 - p));

/** The belief whose score (and lower bound) `toScore` reads back as `score` (`low`), after `n` answers. */
export function beliefFor(score: number, low: number, n: number): Belief {
  const mu = logit(score / 100);
  const sd = mu - logit(low / 100);
  return { mu, v: sd * sd, n };
}

/** The categories the showcase's Skills screen shows, in the Skills tab's order. */
export const DEMO_CATEGORIES: readonly SkillCategory[] = ['visuals', 'subject', 'text', 'provenance', 'real'];

/** Scores (now, before the last round, lower bound now) for each shown category. */
const ROWS: Partial<Record<SkillCategory, [number, number, number]>> = {
  visuals: [74, 66, 66],
  subject: [63, 60, 52],
  text: [81, 71, 70],
  provenance: [57, 57, 41],
  real: [66, 61, 58],
};

function skillsAt(which: 0 | 1): Skills {
  const out = {} as Skills;
  for (const c of SKILL_CATEGORIES) {
    const r = ROWS[c];
    out[c] = r ? beliefFor(r[which], r[which] - (r[0] - r[2]), which ? 18 : 24) : { ...SKILL_PRIOR };
  }
  return out;
}

export interface DemoSkills {
  now: Skills;
  before: Skills;
  general: { now: Belief; before: Belief };
}

/** A player a few rounds in: general 68 (likely 61–74), up 6 on the last round. */
export function demoSkills(): DemoSkills {
  return {
    now: skillsAt(0),
    before: skillsAt(1),
    general: { now: beliefFor(68, 61, 120), before: beliefFor(62, 54, 96) },
  };
}

export interface GameAnswer {
  /** What the clip really is. */
  truth: 'ai' | 'real';
  /** What the player said. */
  call: 'ai' | 'real';
  /** The feedback's second line, when the clip has no evidence of its own. */
  why: string;
}

/** The player's calls in the round shown: both marked as AI (the second is real where the feed has a real clip). */
export const GAME_CALLS: GameAnswer['call'][] = ['ai', 'ai'];

/** An answer from what the clip really is (its verdict) and the call; the evidence, where the clip has it. */
export function answer(truth: GameAnswer['truth'], call: GameAnswer['call'], evidence?: string): GameAnswer {
  if (truth === 'real') return { truth, call, why: evidence || 'Filmed, not generated.' };
  return { truth, call, why: 'Step through what gave it away.' };
}

export function isRight(a: GameAnswer): boolean {
  return a.truth === a.call;
}
