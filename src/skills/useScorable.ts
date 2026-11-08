import { useEffect, useMemo } from 'react';
import { loadPlayableClips } from '@/game/playable';
import { MIN_CLIPS_TO_SCORE, SKILL_CATEGORIES, categoryCoverage, type SkillCategory } from './categories';
import { loadMetas } from './loadMeta';
import { useSkillState } from './store';

/**
 * The categories with enough clips to score (see MIN_CLIPS_TO_SCORE), from
 * every clip's categories this device has worked out; it works them out for
 * the whole feed once, in the background.
 */
export function useScorableCategories(): { categories: SkillCategory[]; coverage: Record<SkillCategory, number> } {
  const { cats } = useSkillState();
  useEffect(() => {
    loadPlayableClips().then((clips) => loadMetas(clips));
  }, []);
  return useMemo(() => {
    const coverage = categoryCoverage(Object.values(cats));
    return { categories: SKILL_CATEGORIES.filter((c) => coverage[c] >= MIN_CLIPS_TO_SCORE), coverage };
  }, [cats]);
}
