import { useSyncExternalStore } from 'react';
import { devStorage } from '@/devtools/storage';
import { DEV_TOOLS } from '@/devtools/store';
import { GAME } from './config';
import { DEFAULT_DESIGNS, parseDesigns, type GameDesigns } from './designs';

/**
 * Dev-only knobs for the timed round (Dev settings → Game, and the game lab):
 * a shorter round to try the end quickly, a corner label with each clip's
 * truth, and which design each element of the round uses. Production builds
 * always play the full round, with no label and the default designs.
 */
export interface GameDev {
  roundMs: number;
  showTruth: boolean;
  designs: GameDesigns;
  /** Deal clips near the player's skill (adaptive difficulty) instead of a plain shuffle. */
  adaptive: boolean;
  /** Order the feed with the engagement ranker (a proof of concept; applies on the next load). */
  rankFeed: boolean;
}

export const ROUND_LENGTHS = [60_000, 20_000, 8_000] as const;
const KEY = 'double-take:game-dev:v1';
const DEFAULTS: GameDev = { roundMs: GAME.roundMs, showTruth: false, designs: DEFAULT_DESIGNS, adaptive: false, rankFeed: false };

function read(): GameDev {
  if (!DEV_TOOLS) return DEFAULTS;
  try {
    const o = JSON.parse(devStorage?.getItem(KEY) ?? 'null') as Partial<GameDev> | null;
    return {
      roundMs: ROUND_LENGTHS.includes(o?.roundMs as (typeof ROUND_LENGTHS)[number]) ? o!.roundMs! : DEFAULTS.roundMs,
      showTruth: o?.showTruth === true,
      designs: parseDesigns(o?.designs),
      adaptive: o?.adaptive === true,
      rankFeed: o?.rankFeed === true,
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

/** The design each element of the round uses (the defaults in production). */
export function useGameDesigns(): GameDesigns {
  return useGameDev().designs;
}

export function setGameDesign(patch: Partial<GameDesigns>) {
  gameDev.set({ designs: { ...gameDev.getSnapshot().designs, ...patch } });
}
