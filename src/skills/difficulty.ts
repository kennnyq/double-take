/**
 * How hard a clip is to judge: a prior from what the feed knows about it,
 * refined on this device by every answer to it (`updateDifficulty`). On the
 * skill scale: 0 is an average clip; +1 is one an average player gets right
 * about a quarter of the time, −1 three quarters. Pure, for `node --test`.
 */
import type { Belief } from './skill.ts';

/** What the prior reads. */
export interface ClipFacts {
  verdict: 'ai' | 'real';
  /** Placed tells (AI clips). */
  tells?: number;
  /** Of those, ones the annotators rated high-confidence (an obvious artifact). */
  highConfidence?: number;
  /** Tells that are on-screen text (garbled text gives clips away fast). */
  textTells?: number;
  /** Unplaced claims (people argued about it without pointing at a frame). */
  claims?: number;
  /** Real clips: how the harvest knows they're real. */
  tier?: string;
}

/** How unsure the prior is, before any answers. */
export const DIFFICULTY_PRIOR_VAR = 0.8;

/**
 * The prior. AI: every placed tell beyond the first makes it easier, as do
 * high-confidence and on-screen-text tells; a clip with nothing placed is
 * harder (the giveaway is subtle or not visual). Real: old footage is easy to
 * trust; footage a fact-check or forum had to vouch for looked fake to people.
 */
export function priorDifficulty(f: ClipFacts): number {
  if (f.verdict === 'real') {
    if (f.tier === 'real-verified') return 0.6;
    if (f.tier === 'real-consensus') return 0.45;
    if (f.tier === 'real-prior') return -0.15;
    return 0.2;
  }
  const tells = f.tells ?? 0;
  if (tells === 0) return (f.claims ?? 0) > 0 ? 0.35 : 0.5;
  let b = 0.15;
  b -= 0.2 * Math.min(3, tells - 1);
  b -= 0.15 * Math.min(2, f.highConfidence ?? 0);
  b -= 0.2 * Math.min(1, f.textTells ?? 0);
  return Math.max(-1.2, Math.min(1.2, b));
}

export function priorBelief(f: ClipFacts): Belief {
  return { mu: priorDifficulty(f), v: DIFFICULTY_PRIOR_VAR, n: 0 };
}
