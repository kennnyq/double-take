/**
 * What the Skills tab says beyond the scores: a one-line way to spot each
 * kind of giveaway, the skill to practise next, and the milestones reached.
 * Everything here is worked out from the player's own answers on this device
 * (nothing is seeded). Pure, for `node --test`.
 */
import { SKILL_CATEGORIES, type SkillCategory } from './categories.ts';
import { toScore, type Belief, type Skills } from './skill.ts';

/** How to spot each kind, in a line. */
export const SKILL_TIPS: Readonly<Record<SkillCategory, string>> = Object.freeze({
  visuals: 'Watch edges and backgrounds: things that melt, morph or ignore physics.',
  subject: 'Watch hands, teeth and eyes, and how limbs join and move.',
  text: 'Read signs and labels: AI letters garble or change between frames.',
  provenance: 'Check the corners for an AI tool’s watermark or logo.',
  audio: 'Listen for voices out of sync, or sound that doesn’t fit the scene.',
  real: 'Real footage holds up: steady text, hands and physics, natural camera shake.',
  other: 'A too-smooth, dreamlike look is often the only giveaway.',
});

/** Each skill's icon (Ionicons). */
export const SKILL_ICONS: Readonly<Record<SkillCategory, string>> = Object.freeze({
  visuals: 'eye-outline',
  subject: 'hand-left-outline',
  text: 'text-outline',
  provenance: 'water-outline',
  audio: 'volume-high-outline',
  real: 'videocam-outline',
  other: 'sparkles-outline',
});

/** Answers in a skill before it can be called the weakest (one unlucky clip isn't a weakness). */
export const MIN_TO_PRACTISE = 3;

/** The scored skill with the lowest score that has enough answers, if any is below the general score. */
export function weakestSkill(skills: Skills, scored: readonly SkillCategory[], overall: Belief): SkillCategory | null {
  const general = toScore(overall).score;
  let best: { c: SkillCategory; score: number } | null = null;
  for (const c of scored) {
    if (skills[c].n < MIN_TO_PRACTISE) continue;
    const score = toScore(skills[c]).score;
    if (score >= general) continue;
    if (!best || score < best.score) best = { c, score };
  }
  return best?.c ?? null;
}

/** The running counts the milestones and streaks come from. */
export interface SkillStats {
  answers: number;
  correct: number;
  /** AI clips marked AI. */
  aiCaught: number;
  /** Right answers in a row, now. */
  streak: number;
  bestStreak: number;
  rounds: number;
}

export const NO_STATS: SkillStats = Object.freeze({ answers: 0, correct: 0, aiCaught: 0, streak: 0, bestStreak: 0, rounds: 0 });

/** Counts after one more answer. */
export function addAnswer(s: SkillStats, a: { correct: boolean; truth?: 'ai' | 'real' }): SkillStats {
  const streak = a.correct ? s.streak + 1 : 0;
  return {
    ...s,
    answers: s.answers + 1,
    correct: s.correct + (a.correct ? 1 : 0),
    aiCaught: s.aiCaught + (a.correct && a.truth === 'ai' ? 1 : 0),
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
  };
}

export interface Milestone {
  id: string;
  label: string;
  icon: string;
}

/** The milestones reached, in the order they're usually reached. Only real counts; none are handed out. */
export function milestones(s: SkillStats): Milestone[] {
  const out: Milestone[] = [];
  const steps: [boolean, Milestone][] = [
    [s.answers >= 10, { id: 'judged-10', label: '10 judged', icon: 'layers-outline' }],
    [s.bestStreak >= 5, { id: 'streak-5', label: '5 in a row', icon: 'flame-outline' }],
    [s.aiCaught >= 10, { id: 'caught-10', label: '10 AI caught', icon: 'scan-outline' }],
    [s.answers >= 50, { id: 'judged-50', label: '50 judged', icon: 'layers' }],
    [s.bestStreak >= 10, { id: 'streak-10', label: '10 in a row', icon: 'flame' }],
    [s.aiCaught >= 50, { id: 'caught-50', label: '50 AI caught', icon: 'scan' }],
    [s.answers >= 200, { id: 'judged-200', label: '200 judged', icon: 'trophy-outline' }],
  ];
  for (const [reached, m] of steps) if (reached) out.push(m);
  return out;
}

/** The general score over time, one point per answer, kept to the last few. */
export const HISTORY_MAX = 60;

export function pushHistory(history: readonly number[], score: number): number[] {
  const next = [...history, score];
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
}

/** Clips missed, most recent first, kept per skill so each row can show one. */
export const MISSES_MAX = 4;

export function pushMiss(misses: Partial<Record<SkillCategory, string[]>>, key: string, cats: Partial<Record<SkillCategory, number>>): Partial<Record<SkillCategory, string[]>> {
  const out = { ...misses };
  for (const c of SKILL_CATEGORIES) {
    if (!cats[c]) continue;
    out[c] = [key, ...(out[c] ?? []).filter((k) => k !== key)].slice(0, MISSES_MAX);
  }
  return out;
}
