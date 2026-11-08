import { useSyncExternalStore } from 'react';
import type { Clip } from '@/data/clips';
import { settingsStorage } from '@/settings/storage';
import { createHistoryStore, type GameHistory } from './history';
import type { RoundState } from './round';
import type { RoundStats } from './score';
import type { SkillCategory } from '@/skills/categories';
import type { Skills } from '@/skills/skill';

/** Past rounds on this device (best score, summaries, recently dealt clips). */
export const gameHistory = createHistoryStore(settingsStorage);

export function useGameHistory(): GameHistory {
  return useSyncExternalStore(gameHistory.subscribe, gameHistory.getSnapshot, gameHistory.getSnapshot);
}

// ---- the round that just ended, for the results and review screens ----------

export interface FinishedRound {
  round: RoundState;
  stats: RoundStats;
  newBest: boolean;
  /** The best score on this device after this round. */
  best: number;
  /** The player's skills before and after the round, and the categories it tested (set once recorded). */
  skills?: { before: Skills; after: Skills; touched: SkillCategory[] };
  /** The deck's clips by id, for posters and replays. */
  clips: ReadonlyMap<string, Clip>;
}

let last: FinishedRound | null = null;
const listeners = new Set<() => void>();

export function setFinishedRound(r: FinishedRound | null) {
  last = r;
  listeners.forEach((l) => l());
}

export function getFinishedRound(): FinishedRound | null {
  return last;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The round that just ended; null after a reload (results then go back to a new round). */
export function useFinishedRound(): FinishedRound | null {
  return useSyncExternalStore(subscribe, getFinishedRound, getFinishedRound);
}
