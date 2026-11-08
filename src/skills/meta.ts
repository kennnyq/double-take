/**
 * What the skill model knows about a clip: its categories and its difficulty
 * prior, read from the feed's data and its tells file. Pure parts first
 * (`metaFromTells`), then the loader, which fetches each AI clip's tells
 * once per session.
 */
import type { TellsFile } from '../annotations/format.ts';
import { clipCategories, type SkillCategory } from './categories.ts';
import { priorDifficulty, type ClipFacts } from './difficulty.ts';

export interface ClipMeta {
  cats: Partial<Record<SkillCategory, number>>;
  facts: ClipFacts;
  prior: number;
}

export function metaFromTells(clip: { verdict?: 'ai' | 'real'; verdictTier?: string }, file: TellsFile | null): ClipMeta {
  const verdict = clip.verdict ?? 'ai';
  const tells = file?.tells ?? [];
  const facts: ClipFacts = {
    verdict,
    tells: tells.length,
    highConfidence: tells.filter((t) => t.confidence === 'high').length,
    textTells: tells.filter((t) => /text|garbl|letter|sign|caption/i.test(t.category)).length,
    claims: file?.unplaced?.length ?? 0,
    tier: clip.verdictTier,
  };
  const cats = clipCategories({ verdict, tellCategories: tells.map((t) => t.category), claims: (file?.unplaced ?? []).map((u) => u.quote) });
  return { cats, facts, prior: priorDifficulty(facts) };
}
