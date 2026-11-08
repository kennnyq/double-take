/**
 * What the viewer did with each clip on this device, for the feed's ranker.
 * Pure over a key-value store, for `node --test`.
 */
import type { KeyValue } from '../settings/settings.ts';
import { NO_SIGNALS, addEvent, type ClipSignals, type SignalEvent } from './rank.ts';

export const ENGAGEMENT_KEY = 'double-take.engagement.v1';
/** At most this many clips are remembered (the least recently seen go first). */
const MAX_CLIPS = 500;

export interface SignalStore {
  get(key: string): ClipSignals;
  all(): Record<string, ClipSignals>;
  note(key: string, e: SignalEvent, now?: number): void;
  subscribe(l: () => void): () => void;
  reset(): void;
}

export function createSignalStore(kv: KeyValue | null): SignalStore {
  let state: Record<string, ClipSignals> | null = null;
  const listeners = new Set<() => void>();
  const read = () => {
    if (state) return state;
    try {
      const o = JSON.parse(kv?.getItem(ENGAGEMENT_KEY) ?? '{}') as Record<string, Partial<ClipSignals>>;
      state = Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, s]) => [k, { ...NO_SIGNALS, ...s }]));
    } catch {
      state = {};
    }
    return state;
  };
  const commit = (next: Record<string, ClipSignals>) => {
    const keys = Object.keys(next);
    if (keys.length > MAX_CLIPS) {
      for (const k of keys.sort((a, b) => next[a].lastSeen - next[b].lastSeen).slice(0, keys.length - MAX_CLIPS)) delete next[k];
    }
    state = next;
    try {
      kv?.setItem(ENGAGEMENT_KEY, JSON.stringify(next));
    } catch {
      // This session only.
    }
    listeners.forEach((l) => l());
  };
  return {
    get: (key) => read()[key] ?? NO_SIGNALS,
    all: read,
    note(key, e, now = Date.now()) {
      const cur = read();
      commit({ ...cur, [key]: addEvent(cur[key] ?? NO_SIGNALS, e, now) });
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    reset: () => commit({}),
  };
}
