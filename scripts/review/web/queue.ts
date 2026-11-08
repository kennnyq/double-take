/**
 * The review queue: which clips to show, in what order. Pure, so it runs under
 * `node --test` and in the browser (served type-stripped, see appModules.ts).
 */

export type Status = 'keep' | 'discard' | 'needs-work';

/** The parts of a catalog item (scripts/review/catalog.ts) the queue reads. */
export interface QueueItem {
  key: string;
  media?: { duration: number; tells: { name: string; url: string }[] } | null;
  in: { kind: 'feed' | 'batch'; source?: string; name: string; index: number }[];
}

export interface QueueState {
  status: Status | null;
}

export interface Filter {
  /** unreviewed: no keep/drop yet (needs-work counts as unreviewed). */
  status: 'unreviewed' | 'keep' | 'discard' | 'all';
  /** A source id from `sourceOptions` (`feed:local/demo`, `batch:real-2026-11-07`), or `all`. */
  source: string;
  vetted: 'any' | 'vetted' | 'unvetted';
  tells: 'any' | 'with' | 'without';
  /** Include candidates that were never built (no video to show). */
  unbuilt: boolean;
}

export const DEFAULT_FILTER: Filter = { status: 'unreviewed', source: 'all', vetted: 'any', tells: 'any', unbuilt: false };

export const sourceId = (m: QueueItem['in'][number]) => (m.kind === 'feed' ? `feed:${m.source ?? ''}/${m.name}` : `batch:${m.name}`);

/** Where a clip stands: a keep or drop decides it; needs-work and nothing leave it open. */
export function decided(s: QueueState | undefined): 'keep' | 'discard' | null {
  return s?.status === 'keep' || s?.status === 'discard' ? s.status : null;
}

export function matches(it: QueueItem, state: QueueState | undefined, vetted: boolean, f: Filter): boolean {
  const d = decided(state);
  if (f.status === 'unreviewed' ? d !== null : f.status !== 'all' && d !== f.status) return false;
  if (f.source !== 'all' && !it.in.some((m) => sourceId(m) === f.source)) return false;
  if (f.vetted !== 'any' && vetted !== (f.vetted === 'vetted')) return false;
  const tells = !!it.media?.tells.length;
  if (f.tells !== 'any' && tells !== (f.tells === 'with')) return false;
  if (!f.unbuilt && !it.media) return false;
  return true;
}

/**
 * The queue: matching keys in source order (feeds as served, then batch files),
 * clips with tells first within equal standing, so model output comes up early.
 */
export function buildQueue(
  items: QueueItem[],
  states: Record<string, QueueState | undefined>,
  vetted: ReadonlySet<string>,
  f: Filter,
  sourceOrder: string[],
): string[] {
  const rank = (it: QueueItem) => {
    let best = Infinity;
    for (const m of it.in) {
      const i = sourceOrder.indexOf(sourceId(m));
      best = Math.min(best, (i < 0 ? sourceOrder.length : i) * 1e5 + m.index);
    }
    return best;
  };
  return items
    .filter((it) => matches(it, states[it.key], vetted.has(it.key), f))
    .map((it) => ({ key: it.key, tells: it.media?.tells.length ? 0 : 1, rank: rank(it) }))
    .sort((a, b) => a.tells - b.tells || a.rank - b.rank)
    .map((x) => x.key);
}

/** Sources to filter on, with clip counts, in the given order. */
export function sourceOptions(items: QueueItem[], sourceOrder: string[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const it of items) for (const id of new Set(it.in.map(sourceId))) counts.set(id, (counts.get(id) ?? 0) + 1);
  const order = (id: string) => (sourceOrder.includes(id) ? sourceOrder.indexOf(id) : Infinity);
  return [...counts.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([id, count]) => ({ id, label: id.replace(/^feed:/, '').replace(/^batch:/, ''), count }));
}

/** Where to go after deciding the clip at `i`: the next one, or the previous at the end, or nowhere. */
export function nextIndex(i: number, length: number): number {
  return length <= 0 ? -1 : Math.min(i + 1, length - 1);
}
