import { useEffect, useMemo } from 'react';
import { clipKey } from '@/game/deck';
import { loadDealableClips } from '@/game/playable';
import { MIN_CLIPS_TO_SCORE, SKILL_CATEGORIES, categoryCoverage, type SkillCategory } from './categories';
import { loadMetas } from './loadMeta';
import { skillStore, useSkillState } from './store';

/**
 * The categories with enough clips to score (see MIN_CLIPS_TO_SCORE), from
 * every clip's categories this device has worked out; it works out (once, in
 * the background) only those of clips it hasn't seen yet, so after the first
 * visit this costs no requests.
 */
export function useScorableCategories(): { categories: SkillCategory[]; coverage: Record<SkillCategory, number> } {
  const { cats } = useSkillState();
  useEffect(() => {
    void loadDealableClips().then((clips) => {
      const known = skillStore.getSnapshot().cats;
      return loadMetas(clips.filter((c) => !known[clipKey(c)]));
    });
  }, []);
  return useMemo(() => {
    const coverage = categoryCoverage(Object.values(cats));
    return { categories: SKILL_CATEGORIES.filter((c) => coverage[c] >= MIN_CLIPS_TO_SCORE), coverage };
  }, [cats]);
}
