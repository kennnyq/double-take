/**
 * The clip review's decisions store: an append-only JSONL log of events, folded into
 * one state per clip key. Append-only keeps concurrent reviews mergeable in git
 * (.gitattributes marks the file `merge=union`), and undo is just another event.
 *
 * scripts/harvest/review.py folds the same log for the feed build; keep the two in
 * step (both are checked against scripts/review/fixtures/).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUSES = ['keep', 'discard', 'needs-work'] as const;
export type Status = (typeof STATUSES)[number];

/** A reviewer's mark on one annotation: picked as a good tell, and/or a short note. */
export interface TellMark {
  pick: boolean;
  note: string;
}

/**
 * Fields a set event can change. `status: null` clears a decision back to
 * unreviewed. `tells` marks single annotations, keyed by `<run>/<tell id>`
 * (see web/timeline.ts `tellRef`): each entry merges into what's there, and
 * `null` clears it. Readers that predate `tells` (and build_media.py, which
 * only reads `status`) ignore it.
 */
export interface Patch {
  status?: Status | null;
  tags?: string[];
  note?: string;
  tells?: Record<string, Partial<TellMark> | null>;
}

interface Base {
  v: 1;
  id: string;
  /** ISO timestamp. */
  at: string;
  by: string;
  key: string;
}
export interface SetEvent extends Base {
  set: Patch;
  /** Source URL, so the log is readable without the catalog. */
  url?: string;
}
export interface UndoEvent extends Base {
  /** Id of the set event this cancels. */
  undo: string;
}
export type ReviewEvent = SetEvent | UndoEvent;

export interface ClipState {
  key: string;
  status: Status | null;
  tags: string[];
  note: string;
  /** Marked annotations by `<run>/<tell id>`; only ones with a pick or a note. */
  tells: Record<string, TellMark>;
  url?: string;
  by: string;
  at: string;
  /** Live (not undone) set events behind this state. */
  events: number;
}

const isStatus = (s: unknown): s is Status => (STATUSES as readonly unknown[]).includes(s);

/** Parse a log, skipping blank, malformed or conflict-marker lines (counted in `skipped`). */
export function parseLog(text: string): { events: ReviewEvent[]; skipped: number } {
  const events: ReviewEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ReviewEvent;
      if (e && typeof e.id === 'string' && typeof e.key === 'string' && typeof e.at === 'string') {
        if ('undo' in e ? typeof e.undo === 'string' : e.set && typeof e.set === 'object') {
          events.push(e);
          continue;
        }
      }
    } catch {
      // fall through
    }
    skipped++;
  }
  return { events, skipped };
}

/**
 * Fold events into the current state per key. Events apply in (at, id) order, so a
 * union-merged log folds the same on every machine; later fields win, and an undo
 * removes its target wherever it sits in the log.
 */
export function fold(events: ReviewEvent[]): Map<string, ClipState> {
  const undone = new Set<string>();
  for (const e of events) if ('undo' in e) undone.add(e.undo);
  const sorted = events
    .filter((e): e is SetEvent => 'set' in e && !undone.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, ClipState>();
  for (const e of sorted) {
    const s = out.get(e.key) ?? { key: e.key, status: null, tags: [], note: '', tells: {}, by: e.by, at: e.at, events: 0 };
    if (e.set.status === null || isStatus(e.set.status)) s.status = e.set.status;
    if (Array.isArray(e.set.tags)) s.tags = [...new Set(e.set.tags.filter((t) => typeof t === 'string'))];
    if (typeof e.set.note === 'string') s.note = e.set.note;
    if (e.set.tells && typeof e.set.tells === 'object') s.tells = mergeTells(s.tells, e.set.tells);
    if (e.url) s.url = e.url;
    s.by = e.by;
    s.at = e.at;
    s.events++;
    out.set(e.key, s);
  }
  return out;
}

/** Apply a `tells` patch: merge each entry's fields, `null` clears, and an entry left with no pick and no note goes. */
export function mergeTells(cur: Record<string, TellMark>, patch: Record<string, Partial<TellMark> | null>): Record<string, TellMark> {
  const out = { ...cur };
  for (const [ref, m] of Object.entries(patch)) {
    if (m === null || typeof m !== 'object') {
      delete out[ref];
      continue;
    }
    const prev = out[ref] ?? { pick: false, note: '' };
    const next = {
      pick: typeof m.pick === 'boolean' ? m.pick : prev.pick,
      note: typeof m.note === 'string' ? m.note : prev.note,
    };
    if (next.pick || next.note) out[ref] = next;
    else delete out[ref];
  }
  return out;
}

const TELL_REF = /^[\w.-]{1,60}\/[\w.:-]{1,120}$/;

/** Validate a patch from the client. Returns an error message, or null when it is fine. */
export function checkPatch(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'set must be an object';
  const { status, tags, note, tells, ...rest } = p as Record<string, unknown>;
  if (Object.keys(rest).length) return `unknown fields: ${Object.keys(rest).join(', ')}`;
  if (status !== undefined && status !== null && !isStatus(status)) return `bad status ${String(status)}`;
  if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === 'string' && t.length <= 60)))
    return 'tags must be short strings';
  if (note !== undefined && !(typeof note === 'string' && note.length <= 4000)) return 'note must be a string';
  if (tells !== undefined) {
    if (!tells || typeof tells !== 'object' || Array.isArray(tells)) return 'tells must be an object';
    const entries = Object.entries(tells);
    if (!entries.length || entries.length > 100) return 'tells must mark 1-100 annotations';
    for (const [ref, m] of entries) {
      if (!TELL_REF.test(ref)) return `bad tell ref ${ref}`;
      if (m === null) continue;
      if (typeof m !== 'object') return `bad mark for ${ref}`;
      const { pick, note: n, ...more } = m as Record<string, unknown>;
      if (Object.keys(more).length) return `unknown mark fields: ${Object.keys(more).join(', ')}`;
      if (pick !== undefined && typeof pick !== 'boolean') return 'pick must be true or false';
      if (n !== undefined && !(typeof n === 'string' && n.length <= 1000)) return 'a tell note must be a short string';
    }
  }
  if (status === undefined && tags === undefined && note === undefined && tells === undefined) return 'empty patch';
  return null;
}

/** The log on disk. Reads on every call, so edits from git (pull, merge) show up live. */
export class DecisionLog {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  read(): { events: ReviewEvent[]; skipped: number } {
    return existsSync(this.path) ? parseLog(readFileSync(this.path, 'utf8')) : { events: [], skipped: 0 };
  }

  states(): Map<string, ClipState> {
    return fold(this.read().events);
  }

  append(e: Omit<SetEvent, 'v' | 'id' | 'at'> | Omit<UndoEvent, 'v' | 'id' | 'at'>, now = new Date()): ReviewEvent {
    const event = { v: 1, id: randomUUID(), at: now.toISOString(), ...e } as ReviewEvent;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(event) + '\n');
    return event;
  }
}

/**
 * This checkout's log plus read-only logs from other checkouts (e.g. the harvest
 * worker's, which vets clips into its own copy of decisions.jsonl). Both copies
 * live at the same repo path and git merges them as a union, so folding them
 * together shows the state the merged file will have. Writes only go to `own`.
 */
export class MergedLog {
  readonly own: DecisionLog;
  readonly others: DecisionLog[];
  constructor(own: string, others: string[] = []) {
    this.own = new DecisionLog(own);
    this.others = others.filter((p) => p && p !== own).map((p) => new DecisionLog(p));
  }

  read(): { events: ReviewEvent[]; skipped: number; logs: { path: string; writable: boolean; events: number }[] } {
    const parts = [this.own, ...this.others].map((l) => ({ l, r: l.read() }));
    // The same event in two copies (a log copied or merged between checkouts) counts once.
    const seen = new Set<string>();
    const events: ReviewEvent[] = [];
    for (const { r } of parts) for (const e of r.events) if (!seen.has(e.id)) seen.add(e.id) && events.push(e);
    return {
      events,
      skipped: parts.reduce((n, p) => n + p.r.skipped, 0),
      logs: parts.map(({ l, r }) => ({ path: l.path, writable: l === this.own, events: r.events.length })),
    };
  }

  states(): Map<string, ClipState> {
    return fold(this.read().events);
  }
}

/** Reviewer name (and tag) the harvest worker stamps on clips it has vetted. */
export const WORKER_VETTED = 'worker-vetted';

/** Keys with a live (not undone) set event by the harvest worker, or tagged as vetted by it. */
export function vettedKeys(events: ReviewEvent[], by = WORKER_VETTED): Set<string> {
  const undone = new Set<string>();
  for (const e of events) if ('undo' in e) undone.add(e.undo);
  const out = new Set<string>();
  for (const e of events)
    if ('set' in e && !undone.has(e.id) && (e.by === by || (Array.isArray(e.set.tags) && e.set.tags.includes(by)))) out.add(e.key);
  return out;
}
