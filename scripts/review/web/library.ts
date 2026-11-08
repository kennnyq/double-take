/**
 * The clip grid: every clip, grouped, filtered and sorted. Pure, so it runs under
 * `node --test` and in the browser (served type-stripped, see appModules.ts).
 */
import { decided, sourceId, type QueueItem } from './queue.ts';

export interface LibraryItem extends QueueItem {
  kind: 'ai' | 'real' | 'cgi' | 'unknown';
  author?: string | null;
  title?: string | null;
  evidence?: string;
  date?: number;
  media?: (QueueItem['media'] & { duration: number }) | null;
}

export interface LibraryState {
  status: 'keep' | 'discard' | 'needs-work' | null;
  by?: string;
  at?: string;
  note?: string;
  tells?: Record<string, { pick: boolean; note: string }>;
}

/** Tells of a clip's shipped run, once fetched: how many, and their categories. */
export interface TellStats {
  count: number;
  categories: string[];
}

export interface LibraryCtx {
  states: Record<string, LibraryState | undefined>;
  vetted: ReadonlySet<string>;
  tellStats: ReadonlyMap<string, TellStats>;
  /** The reviewer name the worker stamps (decisions.ts WORKER_VETTED). */
  worker?: string;
}

export const GROUPS = {
  none: 'No grouping',
  source: 'Batch / feed',
  kind: 'AI / real',
  status: 'Decision',
  reviewer: 'Reviewed by',
  tells: 'Tell count',
  category: 'Tell category',
} as const;
export type GroupBy = keyof typeof GROUPS;

export const SORTS = {
  queue: 'Feed order',
  newest: 'Newest',
  oldest: 'Oldest',
  long: 'Longest',
  short: 'Shortest',
  tells: 'Most tells',
  reviewed: 'Recently reviewed',
} as const;
export type SortBy = keyof typeof SORTS;

const KIND = { ai: 'AI', real: 'Real', cgi: 'CGI / animation', unknown: 'Other label' } as const;
const STATUS = { keep: 'Kept', discard: 'Dropped', 'needs-work': 'Needs work' } as const;

/** Every facet value a clip has, by facet (a clip can be in several sources and categories). */
export function facetValues(it: LibraryItem, ctx: LibraryCtx): Record<Exclude<GroupBy, 'none'> | 'marks', string[]> {
  const st = ctx.states[it.key];
  const d = decided(st ?? undefined);
  const worker = ctx.worker ?? 'worker-vetted';
  const stats = ctx.tellStats.get(it.key);
  const runs = it.media?.tells.length ?? 0;
  const n = stats?.count;
  const marks = Object.values(st?.tells ?? {});
  return {
    source: [...new Set(it.in.map((m) => sourceId(m).replace(/^(feed|batch):/, '')))],
    kind: [KIND[it.kind] ?? KIND.unknown],
    status: [st?.status ? STATUS[st.status] : 'Unreviewed'],
    reviewer: [!d ? 'Not decided' : st?.by === worker ? 'Worker-vetted' : `Reviewed by ${st?.by ?? 'someone'}`],
    tells: [!it.media ? 'Not built' : !runs ? 'No tells' : n === undefined ? 'Tells (counting…)' : n === 0 ? 'No tells' : n <= 2 ? '1–2 tells' : n <= 5 ? '3–5 tells' : '6+ tells'],
    category: stats?.categories.length ? [...new Set(stats.categories)] : [runs ? 'Uncategorised' : 'No tells'],
    marks: [
      ...(marks.some((m) => m.pick) ? ['★ Picked tells'] : []),
      // The worker's stock vetting note isn't feedback; a reviewer's note or a tell note is.
      ...((st?.note && st.by !== worker) || marks.some((m) => m.note) ? ['Has notes'] : []),
    ],
  };
}

export interface Filter {
  q: string;
  /** facet → accepted values (OR within a facet, AND across facets). */
  chips: Record<string, string[]>;
  unbuilt: boolean;
}

export function filterItems(items: LibraryItem[], ctx: LibraryCtx, f: Filter): LibraryItem[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (!f.unbuilt && !it.media) return false;
    const v = facetValues(it, ctx);
    for (const [facet, accepted] of Object.entries(f.chips)) {
      if (!accepted.length) continue;
      const have = v[facet as keyof typeof v] ?? [];
      if (!have.some((x) => accepted.includes(x))) return false;
    }
    if (words.length) {
      const st = ctx.states[it.key];
      const hay = [it.key, it.author, it.title, it.evidence, st?.note, ...Object.values(st?.tells ?? {}).map((m) => m.note)].join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function sortItems(items: LibraryItem[], ctx: LibraryCtx, by: SortBy, sourceOrder: string[]): LibraryItem[] {
  const rank = (it: LibraryItem) => {
    let best = Infinity;
    for (const m of it.in) {
      const i = sourceOrder.indexOf(sourceId(m));
      best = Math.min(best, (i < 0 ? sourceOrder.length : i) * 1e5 + m.index);
    }
    return best;
  };
  const cmp: Record<SortBy, (a: LibraryItem, b: LibraryItem) => number> = {
    queue: () => 0,
    newest: (a, b) => (b.date ?? 0) - (a.date ?? 0),
    oldest: (a, b) => (a.date ?? Infinity) - (b.date ?? Infinity),
    long: (a, b) => (b.media?.duration ?? 0) - (a.media?.duration ?? 0),
    short: (a, b) => (a.media?.duration ?? Infinity) - (b.media?.duration ?? Infinity),
    tells: (a, b) => (ctx.tellStats.get(b.key)?.count ?? -1) - (ctx.tellStats.get(a.key)?.count ?? -1),
    reviewed: (a, b) => (ctx.states[b.key]?.at ?? '').localeCompare(ctx.states[a.key]?.at ?? ''),
  };
  return [...items].sort((a, b) => cmp[by](a, b) || rank(a) - rank(b));
}

/** Groups in a sensible order: a fixed one for decisions, tell counts and kinds, else biggest first, "no …" last. */
export function groupItems(items: LibraryItem[], ctx: LibraryCtx, by: GroupBy): { title: string; keys: string[] }[] {
  if (by === 'none') return [{ title: 'All clips', keys: items.map((i) => i.key) }];
  const map = new Map<string, string[]>();
  for (const it of items) for (const v of facetValues(it, ctx)[by]) (map.get(v) ?? map.set(v, []).get(v)!).push(it.key);
  const fixed: Partial<Record<GroupBy, string[]>> = {
    status: ['Unreviewed', 'Needs work', 'Kept', 'Dropped'],
    tells: ['6+ tells', '3–5 tells', '1–2 tells', 'Tells (counting…)', 'No tells', 'Not built'],
    kind: Object.values(KIND),
    reviewer: ['Not decided', 'Worker-vetted'],
  };
  const order = fixed[by];
  const last = (t: string) => /^(No |Not |Uncategorised)/.test(t);
  return [...map.entries()]
    .sort(([a, ak], [b, bk]) => {
      if (order) {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
      }
      if (last(a) !== last(b)) return last(a) ? 1 : -1;
      return bk.length - ak.length || a.localeCompare(b);
    })
    .map(([title, keys]) => ({ title, keys }));
}

/** Chip values per facet, with counts, for the filter bar (counts ignore that facet's own selection). */
export function chipCounts(items: LibraryItem[], ctx: LibraryCtx, f: Filter, facets: string[]): Record<string, [string, number][]> {
  const out: Record<string, [string, number][]> = {};
  for (const facet of facets) {
    const others = { ...f, chips: { ...f.chips, [facet]: [] } };
    const counts = new Map<string, number>();
    for (const it of filterItems(items, ctx, others)) for (const v of facetValues(it, ctx)[facet as keyof ReturnType<typeof facetValues>] ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
    out[facet] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return out;
}
