/**
 * The tells file the app downloads for a clip (`media/<clip>/v1/tells.<hash>.json`).
 *
 * Version 1 files (hand-written, see scripts/harvest/tells/) only have
 * id/category/label/detail/t0/t1/box. Version 2 adds where each tell came
 * from and how far it has been checked, so the app never presents a model's
 * draft as a verified finding. Every v2 field is optional for readers, so a
 * v1 file still parses and an older app still reads a v2 file.
 *
 * Pure: no React Native imports, runs under `node --test`.
 */

/** A rectangle as fractions (0..1) of the full, uncropped video frame. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a tell's claim comes from. */
export type TellSource = 'community_note' | 'comment' | 'model' | 'curator';

/**
 * How far a tell has been checked.
 *  - `unreviewed`: an automatic draft (model output that passed validation). Not verified.
 *  - `spot_checked`: someone looked at the frames and the box sits on the named thing.
 *  - `verified`: a person confirmed the artifact itself, not just the box placement.
 */
export type Review = 'unreviewed' | 'spot_checked' | 'verified';

export type Confidence = 'low' | 'medium' | 'high';

export interface Evidence {
  /** Exact words from the note or comment that make the claim. */
  quote: string;
  from: 'community_note' | 'comment';
  /** Permalink of the note or comment, when known. */
  url?: string;
  /** Comment author handle (never shown for notes; notes are anonymous). */
  author?: string;
}

export interface Tell {
  id: string;
  category: string;
  /** Short label drawn next to the box (≤ 60 chars). */
  label: string;
  /** One or two sentences: what to look at and why it gives the clip away. */
  detail?: string;
  /** Window (seconds) in which the box is drawn during playback. */
  t0: number;
  t1: number;
  /** The best moment to pause on; inside [t0, t1]. Defaults to near t0. */
  focusT?: number;
  /**
   * A second moment for before/after tells (an object that vanishes or
   * changes): the same box at this time shows the difference. Inside [t0, t1].
   */
  compareT?: number;
  /** Omitted when the tell can't be pinned to a region (e.g. a voice). */
  box?: Box;
  source?: TellSource;
  review?: Review;
  confidence?: Confidence;
  evidence?: Evidence;
  /** False when the model could not see the claimed artifact in the frames. */
  seenInFrames?: boolean;
  /** Pixel comparison of the boxed region across frames (see pixelCheck.ts); a signal, not proof. */
  pixelCheck?: 'changed' | 'unchanged';
  /** Model that drafted the box/timing, e.g. `nvidia/nemotron-3.5-super-vl-120b-a12b`. */
  model?: string;
  /** The camera shot the box belongs to (between scene cuts); [t0, t1] lies inside it. */
  shot?: { t0: number; t1: number };
}

/**
 * A claim from the note or comments that couldn't be placed on the video: no
 * time in the source, and the model couldn't find or outline it (often audio,
 * or something the frames don't show). Listed at the end of the walkthrough.
 */
export interface UnplacedClaim {
  quote: string;
  from: 'community_note' | 'comment';
  url?: string;
  author?: string;
  /** not_seen: the model looked and couldn't find it; not_checked: the model skipped it. */
  reason: 'not_seen' | 'not_checked';
}

export interface Provenance {
  /** Pipeline step that wrote the file, e.g. `annotate@1`. */
  pipeline: string;
  generatedAt: string;
  clip: { id: string; url?: string; sha256?: string };
  note?: { id?: string; url?: string; text: string; status?: string };
  comments?: { count: number; source: string; capturedAt?: string };
  models?: string[];
  /** Model ids the API reported for each request (the hosted API may route to a differently named build). */
  servedBy?: Record<string, string>;
  frames?: { count: number; times: number[]; crop?: Box };
  /** Review decisions applied before publishing (rejected tells are listed here, not shipped). */
  review?: ReviewDecision[];
}

export interface ReviewDecision {
  tell: string;
  /** What the tell said, so a rejection stays readable after the draft is gone. */
  label?: string;
  action: 'reject' | 'spot_check' | 'verify';
  /** `agent` decisions can only reject; promoting a tell takes a person. */
  by: 'agent' | 'human';
  why: string;
  at: string;
}

export interface TellsFile {
  version: 1 | 2;
  tells: Tell[];
  unplaced?: UnplacedClaim[];
  provenance?: Provenance;
}

const SOURCES: readonly TellSource[] = ['community_note', 'comment', 'model', 'curator'];
const REVIEWS: readonly Review[] = ['unreviewed', 'spot_checked', 'verified'];
const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high'];

const isUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** A box is usable when it is inside the frame and has some area. */
export function isBox(b: unknown): b is Box {
  const r = b as Box;
  return (
    !!r &&
    [r.x, r.y, r.w, r.h].every(isUnit) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w <= 1 + 1e-6 &&
    r.y + r.h <= 1 + 1e-6
  );
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

/**
 * Read one tell from untrusted JSON. Returns null when the essentials are
 * missing or wrong; optional fields that are malformed are dropped, not fatal.
 */
export function readTell(t: unknown, i = 0): Tell | null {
  const r = t as Record<string, unknown>;
  if (!r || typeof r !== 'object') return null;
  const { label, t0, t1 } = r;
  if (typeof label !== 'string' || !label.trim()) return null;
  if (typeof t0 !== 'number' || typeof t1 !== 'number' || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  if (t0 < 0 || t1 <= t0) return null;
  // v1 required a box; in v2 a missing box is fine, but a present, broken one is not.
  if (r.box !== undefined && r.box !== null && !isBox(r.box)) return null;

  const out: Tell = {
    id: typeof r.id === 'string' && r.id ? r.id : `tell-${i}`,
    category: typeof r.category === 'string' ? r.category : 'other',
    label: label.trim(),
    t0,
    t1,
  };
  if (typeof r.detail === 'string' && r.detail.trim()) out.detail = r.detail.trim();
  if (typeof r.focusT === 'number' && r.focusT >= t0 && r.focusT <= t1) out.focusT = r.focusT;
  if (typeof r.compareT === 'number' && r.compareT >= t0 && r.compareT <= t1 && r.compareT !== out.focusT) out.compareT = r.compareT;
  if (isBox(r.box)) out.box = r.box;
  const source = oneOf(SOURCES, r.source) ?? (r.source === 'frames' ? 'curator' : undefined);
  if (source) out.source = source;
  // v1 files mark hand-checked tells with `checked: "frames"`.
  const review = oneOf(REVIEWS, r.review) ?? (r.checked === 'frames' ? 'spot_checked' : undefined);
  if (review) out.review = review;
  const confidence = oneOf(CONFIDENCES, r.confidence);
  if (confidence) out.confidence = confidence;
  const ev = r.evidence as Record<string, unknown> | undefined;
  if (ev && typeof ev.quote === 'string' && (ev.from === 'community_note' || ev.from === 'comment')) {
    out.evidence = { quote: ev.quote, from: ev.from };
    if (typeof ev.url === 'string') out.evidence.url = ev.url;
    if (typeof ev.author === 'string') out.evidence.author = ev.author;
  }
  if (typeof r.seenInFrames === 'boolean') out.seenInFrames = r.seenInFrames;
  if (r.pixelCheck === 'changed' || r.pixelCheck === 'unchanged') out.pixelCheck = r.pixelCheck;
  if (typeof r.model === 'string') out.model = r.model;
  const shot = r.shot as { t0?: unknown; t1?: unknown } | undefined;
  if (shot && typeof shot.t0 === 'number' && typeof shot.t1 === 'number' && shot.t0 <= t0 && shot.t1 >= t1) out.shot = { t0: shot.t0, t1: shot.t1 };
  return out;
}

/** Read a tells file from untrusted JSON; never throws. */
export function readTellsFile(data: unknown): TellsFile {
  const d = data as { version?: unknown; tells?: unknown; provenance?: unknown };
  const list = Array.isArray(d?.tells) ? d.tells : [];
  const tells = list.map(readTell).filter((t): t is Tell => t !== null);
  const file: TellsFile = { version: d?.version === 2 ? 2 : 1, tells };
  const unplaced = (Array.isArray((d as { unplaced?: unknown })?.unplaced) ? (d as { unplaced: unknown[] }).unplaced : [])
    .map((u) => u as Record<string, unknown>)
    .filter((u) => u && typeof u.quote === 'string' && u.quote.trim() && (u.from === 'community_note' || u.from === 'comment'))
    .map((u) => {
      const out: UnplacedClaim = {
        quote: (u.quote as string).trim(),
        from: u.from as UnplacedClaim['from'],
        reason: u.reason === 'not_checked' ? 'not_checked' : 'not_seen',
      };
      if (typeof u.url === 'string') out.url = u.url;
      if (typeof u.author === 'string') out.author = u.author;
      return out;
    });
  if (unplaced.length) file.unplaced = unplaced;
  if (d?.provenance && typeof d.provenance === 'object') file.provenance = d.provenance as Provenance;
  return file;
}

/** True when the tell is an automatic draft nobody has looked at. */
export const isUnverified = (t: Tell) => (t.review ?? (t.source === 'model' ? 'unreviewed' : undefined)) === 'unreviewed';
