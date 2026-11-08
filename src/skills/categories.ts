/**
 * The skill categories: what kind of giveaway a clip has, as far as the
 * feed's data says. Derived from each AI clip's tells (their `category`,
 * see src/annotations/categories.ts) and from unplaced claims' own words;
 * real clips have their own category (telling real footage apart is a skill
 * too), and AI clips with no categorised tell fall under `other`.
 *
 * The first three ids match the investigation contract's components on the
 * hill-climb lanes (`visuals | subject | audio`); the finer ones name the
 * component they roll up to. Pure, for `node --test`.
 */
import { categoryFromText, normalizeCategory, type Category } from '../annotations/categories.ts';

export const SKILL_CATEGORIES = ['visuals', 'subject', 'text', 'provenance', 'audio', 'real', 'other'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** The investigation contract's components (hill/integration `src/investigation/contract.ts`). */
export type Component = 'visuals' | 'subject' | 'audio';

export const CATEGORY_INFO: Record<SkillCategory, { label: string; component: Component | null }> = {
  visuals: { label: 'Visuals', component: 'visuals' },
  subject: { label: 'Bodies', component: 'subject' },
  text: { label: 'Text', component: 'visuals' },
  provenance: { label: 'Marks', component: 'visuals' },
  audio: { label: 'Sound', component: 'audio' },
  real: { label: 'Real', component: null },
  other: { label: 'Other AI', component: null },
};

/** Where each tell category belongs. */
const FROM_TELL: Record<Category, SkillCategory> = {
  anatomy: 'subject',
  object_morph: 'visuals',
  physics: 'visuals',
  continuity: 'visuals',
  lighting: 'visuals',
  background_shift: 'visuals',
  text: 'text',
  watermark: 'provenance',
  audio: 'audio',
  other: 'other',
};

export function skillCategoryOf(tellCategory: unknown): SkillCategory {
  return FROM_TELL[normalizeCategory(tellCategory)];
}

/** What a clip's categories are worked out from. */
export interface CategorySource {
  verdict: 'ai' | 'real';
  tellCategories?: readonly unknown[];
  /** Unplaced claims' quotes (note or comments). */
  claims?: readonly string[];
}

/**
 * A clip's categories as weights summing to 1: each placed tell counts 1,
 * each unplaced claim that clearly names a category ½. A real clip is
 * `real`; an AI clip with nothing categorised is `other`.
 */
export function clipCategories(src: CategorySource): Partial<Record<SkillCategory, number>> {
  if (src.verdict === 'real') return { real: 1 };
  const raw: Partial<Record<SkillCategory, number>> = {};
  for (const c of src.tellCategories ?? []) {
    const k = skillCategoryOf(c);
    raw[k] = (raw[k] ?? 0) + 1;
  }
  for (const q of src.claims ?? []) {
    const c = categoryFromText(q);
    if (!c) continue;
    const k = FROM_TELL[c];
    raw[k] = (raw[k] ?? 0) + 0.5;
  }
  // `other` only stands in when nothing more specific is known.
  const specific = Object.entries(raw).filter(([k]) => k !== 'other');
  const pairs = specific.length ? specific : Object.entries(raw);
  const total = pairs.reduce((n, [, w]) => n + (w ?? 0), 0);
  if (!total) return { other: 1 };
  return Object.fromEntries(pairs.map(([k, w]) => [k, (w ?? 0) / total]));
}

/** How many clips have each category (any weight): which categories have enough to score. */
export function categoryCoverage(all: readonly Partial<Record<SkillCategory, number>>[]): Record<SkillCategory, number> {
  const n = Object.fromEntries(SKILL_CATEGORIES.map((c) => [c, 0])) as Record<SkillCategory, number>;
  for (const cats of all) for (const k of Object.keys(cats) as SkillCategory[]) n[k]++;
  return n;
}

/** Fewer clips than this in a category and it isn't scored (shown as not enough yet). */
export const MIN_CLIPS_TO_SCORE = 8;
