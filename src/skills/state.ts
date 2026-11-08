/**
 * The skill state kept on this device: the player's ability per category,
 * every clip's difficulty as answered here, and each clip's categories (for
 * the feed's ranker). Pure over a key-value store, for `node --test`; a
 * Supabase sync for members is a later step.
 */
import type { KeyValue } from '../settings/settings.ts';
import { SKILL_CATEGORIES, type SkillCategory } from './categories.ts';
import { DIFFICULTY_PRIOR_VAR } from './difficulty.ts';
import { freshSkills, recordAnswer, skillForClip, updateDifficulty, type Belief, type Skills } from './skill.ts';

export const SKILLS_KEY = 'double-take.skills.v1';

export interface SkillState {
  skills: Skills;
  /** Difficulty by clip key. */
  clips: Record<string, Belief>;
  /** Categories by clip key, as last seen. */
  cats: Record<string, Partial<Record<SkillCategory, number>>>;
  answers: number;
  rounds: number;
}

export function emptySkillState(): SkillState {
  return { skills: freshSkills(), clips: {}, cats: {}, answers: 0, rounds: 0 };
}

const isBelief = (b: unknown): b is Belief =>
  !!b && typeof b === 'object' && [(b as Belief).mu, (b as Belief).v, (b as Belief).n].every((x) => typeof x === 'number' && Number.isFinite(x)) && (b as Belief).v > 0;

export function parseSkillState(raw: string | null | undefined): SkillState {
  const s = emptySkillState();
  try {
    const o = raw ? (JSON.parse(raw) as Partial<SkillState>) : null;
    if (!o || typeof o !== 'object') return s;
    for (const c of SKILL_CATEGORIES) if (isBelief(o.skills?.[c])) s.skills[c] = o.skills![c];
    for (const [k, b] of Object.entries(o.clips ?? {})) if (isBelief(b)) s.clips[k] = b;
    for (const [k, c] of Object.entries(o.cats ?? {})) if (c && typeof c === 'object') s.cats[k] = c;
    s.answers = typeof o.answers === 'number' ? o.answers : 0;
    s.rounds = typeof o.rounds === 'number' ? o.rounds : 0;
  } catch {
    // Corrupt storage: start over.
  }
  return s;
}

export interface Answer {
  key: string;
  correct: boolean;
  cats: Partial<Record<SkillCategory, number>>;
  /** The clip's difficulty prior, for a clip this device hasn't seen answered. */
  prior: number;
}

/** A round's answers folded in, in the order they were given. */
export function applyRound(state: SkillState, answers: readonly Answer[]): SkillState {
  let skills = state.skills;
  const clips = { ...state.clips };
  const cats = { ...state.cats };
  for (const a of answers) {
    const d = clips[a.key] ?? { mu: a.prior, v: DIFFICULTY_PRIOR_VAR, n: 0 };
    const theta = skillForClip(skills, a.cats);
    skills = recordAnswer(skills, a.cats, d.mu, a.correct);
    clips[a.key] = updateDifficulty(d, theta, a.correct);
    cats[a.key] = a.cats;
  }
  return { skills, clips, cats, answers: state.answers + answers.length, rounds: state.rounds + (answers.length ? 1 : 0) };
}

/** A clip's current difficulty: answered here, else its prior. */
export function difficultyOf(state: SkillState, key: string, prior: number): number {
  return state.clips[key]?.mu ?? prior;
}

export interface SkillStore {
  getSnapshot(): SkillState;
  subscribe(l: () => void): () => void;
  recordRound(answers: readonly Answer[]): { before: Skills; after: Skills };
  rememberCategories(cats: ReadonlyMap<string, Partial<Record<SkillCategory, number>>>): void;
  reset(): void;
}

export function createSkillStore(kv: KeyValue | null): SkillStore {
  let state: SkillState | null = null;
  const listeners = new Set<() => void>();
  const read = () => {
    if (state) return state;
    let raw: string | null = null;
    try {
      raw = kv?.getItem(SKILLS_KEY) ?? null;
    } catch {
      // Blocked storage: this session only.
    }
    state = parseSkillState(raw);
    return state;
  };
  const commit = (next: SkillState) => {
    state = next;
    try {
      kv?.setItem(SKILLS_KEY, JSON.stringify(next));
    } catch {
      // Not saved; it still counts until the app reloads.
    }
    listeners.forEach((l) => l());
  };
  return {
    getSnapshot: read,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    recordRound(answers) {
      const before = read().skills;
      const next = applyRound(read(), answers);
      commit(next);
      return { before, after: next.skills };
    },
    rememberCategories(map) {
      const cur = read();
      let changed = false;
      const cats = { ...cur.cats };
      for (const [k, c] of map) {
        if (JSON.stringify(cats[k]) === JSON.stringify(c)) continue;
        cats[k] = c;
        changed = true;
      }
      if (changed) commit({ ...cur, cats });
    },
    reset: () => commit(emptySkillState()),
  };
}
