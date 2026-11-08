/**
 * "Needs your eyes": the hill climb's ranked clips where a reviewer would help
 * (scripts/review/needsEyes.ts reads and validates the file). Pure, so it runs
 * under `node --test` and in the browser.
 */

export interface EyesItem {
  id: string;
  rank: number;
  clipId: string;
  sourceClipId?: string;
  reason: string;
  question: string;
  whyHumanHelps: string;
  timeRange?: { t0: number; t1: number };
}

export interface EyesState {
  by?: string;
  at?: string;
}

/** The catalog key an item points at. */
export const eyesKey = (it: Pick<EyesItem, 'clipId' | 'sourceClipId'>) => it.sourceClipId ?? it.clipId;

/** One item per clip (its best rank), by clip key. */
export function eyesIndex(items: EyesItem[]): Map<string, EyesItem> {
  const out = new Map<string, EyesItem>();
  for (const it of [...items].sort((a, b) => a.rank - b.rank)) if (!out.has(eyesKey(it))) out.set(eyesKey(it), it);
  return out;
}

/** The queue: clip keys by rank, only clips the review site has. */
export function eyesQueue(items: EyesItem[], has: (key: string) => boolean): string[] {
  return [...eyesIndex(items).keys()].filter(has);
}

/**
 * Answered here: a reviewer (not the harvest worker) decided, noted or starred the
 * clip after the queue was generated. The hill climb reads decisions.jsonl itself;
 * this only marks the item done on the page.
 */
export function answered(st: EyesState | undefined, generatedAt: string | null, worker = 'worker-vetted'): boolean {
  if (!st?.at || !st.by || st.by === worker) return false;
  return !generatedAt || st.at > generatedAt;
}

const REASONS: Record<string, string> = {
  conflicting_evidence: 'Conflicting evidence',
  unresolved_localization: 'Where is it?',
  ambiguous_observation: 'Ambiguous',
};
export const reasonLabel = (r: string) => REASONS[r] ?? r.replace(/_/g, ' ');
