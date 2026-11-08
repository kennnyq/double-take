/**
 * A simulated player, for the game lab and the tests: a bot with a true
 * ability per category plays rounds against clips with true difficulties;
 * the app only sees its answers and estimates both, exactly as it does for a
 * person. Shows whether the estimates find the truth, and whether adaptive
 * dealing keeps the bot near its target success rate. Pure, for `node --test`.
 */
import { buildAdaptiveDeck, ADAPTIVE_TARGET } from '../game/adaptive.ts';
import { buildDeck, seededRng } from '../game/deck.ts';
import { SKILL_CATEGORIES, type SkillCategory } from './categories.ts';
import { freshSkills, generalSkill, pCorrect, recordAnswer, sigmoid, skillForClip, toScore, updateDifficulty, type Belief, type Skills } from './skill.ts';

export interface SimClip {
  id: string;
  verdict: 'ai' | 'real';
  aspect?: number;
  cats: Partial<Record<SkillCategory, number>>;
  /** The app's prior for its difficulty. */
  prior: number;
  /** The truth the bot plays against (prior plus noise the app can't see). */
  trueDifficulty: number;
}

export interface SimOptions {
  /** The bot's true ability per category (missing ones take `base`). */
  base: number;
  ability?: Partial<Record<SkillCategory, number>>;
  rounds: number;
  /** Clips judged per round. */
  perRound: number;
  adaptive: boolean;
  seed?: number;
}

export interface SimRound {
  round: number;
  /** The app's general score after this round, and the bot's true one (both 0–100 on an average clip). */
  estimate: number;
  low: number;
  high: number;
  truth: number;
  /** Share answered right this round. */
  success: number;
  /** Mean true difficulty dealt. */
  dealt: number;
  /** Per category: estimated score after the round. */
  categories: Partial<Record<SkillCategory, number>>;
}

export function trueAbility(o: Pick<SimOptions, 'base' | 'ability'>, c: SkillCategory): number {
  return o.ability?.[c] ?? o.base;
}

/** The bot's true general score: its abilities weighted by how often the pool tests each. */
export function trueScore(o: Pick<SimOptions, 'base' | 'ability'>, pool: readonly SimClip[]): number {
  let w = 0;
  let mu = 0;
  for (const clip of pool) for (const [c, x] of Object.entries(clip.cats) as [SkillCategory, number][]) {
    w += x;
    mu += x * trueAbility(o, c);
  }
  return Math.round(100 * sigmoid(w ? mu / w : o.base));
}

export function simulate(pool: readonly SimClip[], o: SimOptions): SimRound[] {
  const rng = seededRng(o.seed ?? 7);
  let skills: Skills = freshSkills();
  const diff = new Map<string, Belief>(pool.map((c) => [c.id, { mu: c.prior, v: 0.8, n: 0 }]));
  const recent: string[][] = [];
  const out: SimRound[] = [];
  const truth = trueScore(o, pool);
  for (let r = 0; r < o.rounds; r++) {
    const sources = pool.map((c) => ({ ...c, difficulty: diff.get(c.id)!.mu }));
    const deck = o.adaptive
      ? buildAdaptiveDeck(sources, { skills, rng, recent: recent.flat(), cap: o.perRound })
      : buildDeck(sources, { rng, recent: recent.flat(), cap: o.perRound });
    let right = 0;
    let dealt = 0;
    for (const card of deck) {
      const clip = card.clip as SimClip;
      const theta = Object.entries(clip.cats).reduce((s, [c, x]) => s + (x ?? 0) * trueAbility(o, c as SkillCategory), 0);
      const correct = rng() < pCorrect(theta, clip.trueDifficulty);
      if (correct) right++;
      dealt += clip.trueDifficulty;
      const d = diff.get(clip.id)!;
      const thetaHat = skillForClip(skills, clip.cats);
      skills = recordAnswer(skills, clip.cats, d.mu, correct);
      diff.set(clip.id, updateDifficulty(d, thetaHat, correct));
    }
    recent.unshift(deck.map((c) => c.id));
    recent.length = Math.min(recent.length, 2);
    const g = toScore(generalSkill(skills));
    out.push({
      round: r + 1,
      estimate: g.score,
      low: g.low,
      high: g.high,
      truth,
      success: deck.length ? right / deck.length : 0,
      dealt: deck.length ? dealt / deck.length : 0,
      categories: Object.fromEntries(SKILL_CATEGORIES.filter((c) => skills[c].n > 0).map((c) => [c, toScore(skills[c]).score])),
    });
  }
  return out;
}

/** A pool for simulation from real clip facts: the truth is the prior plus noise (the prior is only a guess). */
export function simPool<C extends { id: string; verdict?: 'ai' | 'real'; aspect?: number }>(
  clips: readonly C[],
  facts: (c: C) => { cats: Partial<Record<SkillCategory, number>>; prior: number },
  seed = 3,
  noise = 0.6,
): SimClip[] {
  const rng = seededRng(seed);
  // Box–Muller for a normal draw.
  const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return clips
    .filter((c) => c.verdict)
    .map((c) => {
      const f = facts(c);
      return { id: c.id, verdict: c.verdict!, aspect: c.aspect, cats: f.cats, prior: f.prior, trueDifficulty: f.prior + noise * normal() };
    });
}

export { ADAPTIVE_TARGET };
