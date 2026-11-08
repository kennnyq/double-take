import { useSyncExternalStore } from 'react';
import { settingsStorage } from '@/settings/storage';
import type { SkillCategory } from './categories';
import { createSkillStore, type SkillState } from './state';

/** The player's skills on this device. */
export const skillStore = createSkillStore(settingsStorage);

export function useSkillState(): SkillState {
  return useSyncExternalStore(skillStore.subscribe, skillStore.getSnapshot, skillStore.getSnapshot);
}

export function rememberCategories(map: ReadonlyMap<string, Partial<Record<SkillCategory, number>>>) {
  skillStore.rememberCategories(map);
}
