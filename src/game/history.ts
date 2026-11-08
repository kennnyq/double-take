/**
 * What the device remembers about past rounds: the best score, the last few
 * round summaries, and which clips recent rounds dealt (so the next deck
 * prefers others). Pure over a key-value store, for `node --test`;
 * `store.ts` binds it to the device's storage and React.
 *
 * Kept on the device only for now; a shared leaderboard can read the same
 * summaries later.
 */
import type { KeyValue } from '../settings/settings.ts';
import { GAME } from './config.ts';

export const HISTORY_KEY = 'double-take.game.v1';

export interface RoundSummary {
  /** Date.now() when the round ended. */
  endedAt: number;
  score: number;
  judged: number;
  accuracy: number;
  hits: number;
  aiSeen: number;
  falseAlarms: number;
  durationMs: number;
}

export interface GameHistory {
  best: number;
  /** Newest first. */
  rounds: RoundSummary[];
  /** Clip keys each recent round dealt, newest first. */
  recentDecks: string[][];
}

export const EMPTY_HISTORY: GameHistory = Object.freeze({ best: 0, rounds: [], recentDecks: [] }) as GameHistory;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseSummary(v: unknown): RoundSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    endedAt: num(o.endedAt),
    score: Math.max(0, num(o.score)),
    judged: Math.max(0, num(o.judged)),
    accuracy: Math.min(1, Math.max(0, num(o.accuracy))),
    hits: Math.max(0, num(o.hits)),
    aiSeen: Math.max(0, num(o.aiSeen)),
    falseAlarms: Math.max(0, num(o.falseAlarms)),
    durationMs: Math.max(0, num(o.durationMs, GAME.roundMs)),
  };
}

/** History from stored JSON; anything missing or malformed starts empty. */
export function parseHistory(raw: string | null | undefined): GameHistory {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // Corrupt storage: start over.
  }
  const rounds = (Array.isArray(o.rounds) ? o.rounds : []).map(parseSummary).filter((r): r is RoundSummary => r !== null);
  const recentDecks = (Array.isArray(o.recentDecks) ? o.recentDecks : [])
    .filter(Array.isArray)
    .map((d: unknown[]) => d.filter((id): id is string => typeof id === 'string'));
  return {
    best: Math.max(0, num(o.best), ...rounds.map((r) => r.score)),
    rounds: rounds.slice(0, GAME.historyLimit),
    recentDecks: recentDecks.slice(0, GAME.recentRounds),
  };
}

/** The history with one more round in it, and whether it beat the best. */
export function addRound(h: GameHistory, summary: RoundSummary, dealt: readonly string[]): { history: GameHistory; newBest: boolean } {
  const newBest = summary.score > h.best;
  return {
    newBest,
    history: {
      best: Math.max(h.best, summary.score),
      rounds: [summary, ...h.rounds].slice(0, GAME.historyLimit),
      recentDecks: [[...dealt], ...h.recentDecks].slice(0, GAME.recentRounds),
    },
  };
}

/** Every clip key the recent rounds dealt. */
export function recentClipKeys(h: GameHistory): Set<string> {
  return new Set(h.recentDecks.flat());
}

export interface HistoryStore {
  getSnapshot(): GameHistory;
  subscribe(listener: () => void): () => void;
  record(summary: RoundSummary, dealt: readonly string[]): { newBest: boolean };
  clear(): void;
}

export function createHistoryStore(kv: KeyValue | null): HistoryStore {
  let state: GameHistory | null = null;
  const listeners = new Set<() => void>();
  const read = (): GameHistory => {
    if (state) return state;
    let raw: string | null = null;
    try {
      raw = kv?.getItem(HISTORY_KEY) ?? null;
    } catch {
      // Blocked storage: empty for this session.
    }
    state = parseHistory(raw);
    return state;
  };
  const commit = (next: GameHistory) => {
    state = next;
    try {
      kv?.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // Not saved; it still counts until the app reloads.
    }
    listeners.forEach((l) => l());
  };
  return {
    getSnapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record(summary, dealt) {
      const { history, newBest } = addRound(read(), summary, dealt);
      commit(history);
      return { newBest };
    },
    clear: () => commit({ best: 0, rounds: [], recentDecks: [] }),
  };
}
