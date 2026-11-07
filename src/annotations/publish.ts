/**
 * Turning validated drafts into the file the app downloads.
 *
 * Hand-checked tells (v1 files under scripts/harvest/tells/) always win: a
 * model draft that overlaps one is dropped, so publishing a model run can
 * never replace or contradict something a person already checked.
 */
import type { Provenance, ReviewDecision, Tell, TellsFile, UnplacedClaim } from './format.ts';
import { iou } from './geometry.ts';

export interface MergeResult {
  tells: Tell[];
  dropped: { tell: Tell; reason: string }[];
}

const isChecked = (t: Tell) => t.review === 'spot_checked' || t.review === 'verified';

export function mergeTells(existing: Tell[], drafts: Tell[]): MergeResult {
  const checked = existing.filter(isChecked);
  const dropped: MergeResult['dropped'] = [];
  const out: Tell[] = [...checked];
  for (const d of drafts) {
    // A box-less draft adds nothing over a checked tell at the same moment.
    const clash = checked.find(
      (c) => c.t0 <= d.t1 && d.t0 <= c.t1 && (!d.box || c.category === d.category || (!!c.box && iou(c.box, d.box) > 0.3)),
    );
    if (clash) {
      dropped.push({ tell: d, reason: `overlaps checked tell "${clash.label}"` });
      continue;
    }
    out.push(d);
  }
  // Ids must stay unique after merging.
  const used = new Set<string>();
  const tells = out
    .sort((a, b) => a.t0 - b.t0)
    .map((t) => {
      let id = t.id;
      for (let n = 2; used.has(id); n++) id = `${t.id}-${n}`;
      used.add(id);
      return id === t.id ? t : { ...t, id };
    });
  return { tells, dropped };
}

export function buildTellsFile(tells: Tell[], provenance: Provenance, unplaced: UnplacedClaim[] = []): TellsFile {
  return unplaced.length ? { version: 2, tells, unplaced, provenance } : { version: 2, tells, provenance };
}

/**
 * Content-addressed name for a published tells file. Media is served with a
 * day-long cache under a URL that only changes daily, so a new version must
 * get a new name rather than overwrite `tells.json`.
 */
export const tellsFileName = (hash: string) => `tells.${hash.slice(0, 12)}.json`;

/**
 * Apply review decisions to a draft. Anyone may reject a tell. Only a person
 * may mark one spot-checked or verified: an agent looking at frames is still
 * an automatic check, so its "looks right" never upgrades a tell.
 */
export function applyReview(tells: Tell[], decisions: ReviewDecision[]): { tells: Tell[]; applied: ReviewDecision[]; problems: string[] } {
  const problems: string[] = [];
  const applied: ReviewDecision[] = [];
  const byId = new Map(tells.map((t) => [t.id, t]));
  const out = new Map(tells.map((t) => [t.id, t]));
  for (const d of decisions) {
    const t = byId.get(d.tell);
    if (!t) {
      problems.push(`review for "${d.tell}" matches no tell in this draft; ignored`);
      continue;
    }
    if (d.action !== 'reject' && d.by !== 'human') {
      problems.push(`"${d.tell}": only a person can mark a tell ${d.action === 'verify' ? 'verified' : 'spot-checked'}; ignored`);
      continue;
    }
    if (!d.why.trim()) {
      problems.push(`"${d.tell}": a review needs a reason; ignored`);
      continue;
    }
    if (d.action === 'reject') out.delete(d.tell);
    else out.set(d.tell, { ...t, review: d.action === 'verify' ? 'verified' : 'spot_checked' });
    applied.push({ ...d, label: t.label });
  }
  return { tells: tells.filter((t) => out.has(t.id)).map((t) => out.get(t.id)!), applied, problems };
}
