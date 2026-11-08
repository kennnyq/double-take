import { useSyncExternalStore } from 'react';
import { devStorage } from '@/devtools/storage';
import { DEV_TOOLS } from '@/devtools/store';
import { GAME } from './config';

/**
 * Dev-only knobs for the timed round (Dev settings → Game): a shorter round to
 * try the end quickly, and a corner label with each clip's truth. Production
 * builds always play the full round with no label.
 */
export interface GameDev {
  roundMs: number;
  showTruth: boolean;
}

export const ROUND_LENGTHS = [60_000, 20_000, 8_000] as const;
const KEY = 'double-take:game-dev:v1';
const DEFAULTS: GameDev = { roundMs: GAME.roundMs, showTruth: false };

function read(): GameDev {
  if (!DEV_TOOLS) return DEFAULTS;
  try {
    const o = JSON.parse(devStorage?.getItem(KEY) ?? 'null') as Partial<GameDev> | null;
    return {
      roundMs: ROUND_LENGTHS.includes(o?.roundMs as (typeof ROUND_LENGTHS)[number]) ? o!.roundMs! : DEFAULTS.roundMs,
      showTruth: o?.showTruth === true,
    };
  } catch {
    return DEFAULTS;
  }
}

let state = read();
const listeners = new Set<() => void>();

export const gameDev = {
  getSnapshot: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  set(patch: Partial<GameDev>) {
    if (!DEV_TOOLS) return;
    state = { ...state, ...patch };
    try {
      devStorage?.setItem(KEY, JSON.stringify(state));
    } catch {
      // Not kept; it still applies until the app reloads.
    }
    listeners.forEach((l) => l());
  },
  defaults: DEFAULTS,
};

export function useGameDev(): GameDev {
  return useSyncExternalStore(gameDev.subscribe, gameDev.getSnapshot, gameDev.getSnapshot);
}
