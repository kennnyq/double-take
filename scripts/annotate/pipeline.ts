/**
 * Double Take annotation pipeline: sourced clip + Community Note + comments
 * → NVIDIA Nemotron drafts → validated tells → the demo feed.
 *
 *   1. sources   note (with id, status, snapshot) and any captured comments
 *   2. claims    Nemotron text model lists the tells those texts claim (quotes checked)
 *   3. frames    letterbox-aware frame sampling, bracketing every claimed time
 *   4. draft     Nemotron VL boxes each claim on a frame (validated, repaired or rejected)
 *   5. review    report.md + review.jpg with boxes drawn on full frames
 *   6. publish   merge with hand-checked tells, content-addressed file, feed pointer
 *
 * Everything model-made is published as `review: "unreviewed"`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLAIMS_SCHEMA, CLAIMS_SYSTEM, claimsPrompt, validateClaims, type ClaimsResult, type SourceText } from '../../src/annotations/claims.ts';
import { DRAFT_SCHEMA, DRAFT_SYSTEM, MAX_COMPARE_GAP, draftPrompt, validateDraft, type DraftResult } from '../../src/annotations/draft.ts';
import { frameToCrop } from '../../src/annotations/geometry.ts';
import { applyChangeCheck, findChange, wantsChangeCheck } from '../../src/annotations/pixelCheck.ts';
import { readTellsFile, type Provenance, type ReviewDecision, type Tell } from '../../src/annotations/format.ts';
import { completionText } from '../../src/annotations/modelJson.ts';
import { applyReview, buildTellsFile, mergeTells, tellsFileName } from '../../src/annotations/publish.ts';
import { detectCrop, extractFrames, grayFrames, pickTimes, probe, reviewSheet } from './media.ts';
import type { Content, NimClient } from './nim.ts';

export const PIPELINE = 'annotate@1';
export const DEFAULT_TEXT_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
export const DEFAULT_VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export interface Paths {
  build: string; // build/ (feed + media + annotate work dirs)
  notes: string; // scripts/annotate/notes.jsonl
  curated: string; // scripts/harvest/tells/
}

export interface FeedClip {
  id: string;
  video: string;
  poster: string;
  tells: string | null;
  width: number;
  height: number;
  duration: number;
  sha256?: string;
  evidence?: string | null;
  source?: { url?: string; platform?: string };
}

export interface NoteRow {
  tweetId: string;
  noteId: string;
  url: string;
  status: string;
  snapshot: string;
  text: string;
}

export interface CommentRow {
  author?: string;
  text: string;
  url?: string;
  likes?: number;
}

export interface RunOptions {
  textModel?: string;
  visionModel?: string;
  allowModelOnly?: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface ClipRun {
  clipId: string;
  dir: string;
  claims: ClaimsResult;
  draft: DraftResult | null;
  status: 'drafted' | 'no_claims' | 'no_tells';
  provenance: Provenance;
}

// ---------------------------------------------------------------------------

export function readFeed(paths: Paths): { version: number; clips: FeedClip[] } {
  return JSON.parse(readFileSync(join(paths.build, 'feeds', 'demo.json'), 'utf8'));
}

export function findNotes(paths: Paths, clip: FeedClip): NoteRow[] {
  const tweetId = /^x-(\d+)$/.exec(clip.id)?.[1];
  if (!tweetId || !existsSync(paths.notes)) return [];
  return readFileSync(paths.notes, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as NoteRow)
    .filter((n) => n.tweetId === tweetId);
}

/** Comments captured for a clip (build/annotate/<id>/comments.json), if any. */
export function readComments(dir: string): { rows: CommentRow[]; source: string; capturedAt?: string } | null {
  const f = join(dir, 'comments.json');
  if (!existsSync(f)) return null;
  const d = JSON.parse(readFileSync(f, 'utf8')) as { source?: string; capturedAt?: string; comments?: CommentRow[] };
  const rows = (d.comments ?? []).filter((c) => typeof c?.text === 'string' && c.text.trim());
  return { rows, source: d.source ?? 'unknown', capturedAt: d.capturedAt };
}

export function buildSources(clip: FeedClip, notes: NoteRow[], comments: CommentRow[]): SourceText[] {
  const out: SourceText[] = notes.map((n, i) => ({
    ref: i === 0 ? 'note' : `note:${i + 1}`,
    kind: 'community_note' as const,
    text: n.text,
    url: n.url,
  }));
  // Fall back to the note text the harvest kept, without an id.
  if (!out.length && clip.evidence) out.push({ ref: 'note', kind: 'community_note', text: clip.evidence });
  comments.slice(0, 30).forEach((c, i) =>
    out.push({ ref: `comment:${i + 1}`, kind: 'comment', text: c.text.slice(0, 500), url: c.url, author: c.author }),
  );
  return out;
}

const dataUrl = (file: string) => `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;

function save(dir: string, name: string, data: unknown) {
  writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));
}

// ---------------------------------------------------------------------------

export async function annotateClip(client: NimClient, paths: Paths, clip: FeedClip, opts: RunOptions = {}): Promise<ClipRun> {
  const log = opts.log ?? (() => {});
  const textModel = opts.textModel ?? DEFAULT_TEXT_MODEL;
  const visionModel = opts.visionModel ?? DEFAULT_VISION_MODEL;
  const dir = join(paths.build, 'annotate', clip.id);
  mkdirSync(dir, { recursive: true });

  // 1. sources -----------------------------------------------------------------
  const notes = findNotes(paths, clip);
  const comments = readComments(dir);
  const sources = buildSources(clip, notes, comments?.rows ?? []);
  save(dir, 'sources.json', sources);
  const video = join(paths.build, clip.video);
  const p = await probe(video);
  const provenance: Provenance = {
    pipeline: PIPELINE,
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    clip: { id: clip.id, url: clip.source?.url, sha256: clip.sha256 },
    models: [textModel, visionModel],
  };
  if (notes[0]) provenance.note = { id: notes[0].noteId, url: notes[0].url, text: notes[0].text, status: `${notes[0].status} (${notes[0].snapshot} snapshot)` };
  else if (clip.evidence) provenance.note = { text: clip.evidence };
  if (comments) provenance.comments = { count: comments.rows.length, source: comments.source, capturedAt: comments.capturedAt };
  if (!sources.length) throw new Error(`${clip.id}: no note or comments to work from`);

  // 2. claims ------------------------------------------------------------------
  log(`${clip.id}: claims from ${sources.length} source(s) via ${textModel}`);
  const claimsReq = {
    model: textModel,
    messages: [
      { role: 'system' as const, content: CLAIMS_SYSTEM },
      { role: 'user' as const, content: claimsPrompt(sources) },
    ],
    guided_json: CLAIMS_SCHEMA,
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 1500,
  };
  save(dir, 'claims.request.json', claimsReq);
  const claimsResp = await client.chat(claimsReq);
  save(dir, 'claims.response.json', claimsResp);
  const servedBy: Record<string, string> = {};
  const served = (resp: unknown, requested: string) => {
    const m = (resp as { model?: unknown })?.model;
    if (typeof m === 'string' && m) servedBy[requested] = m;
    provenance.servedBy = servedBy;
  };
  served(claimsResp, textModel);
  const claims = validateClaims(completionText(claimsResp), sources);
  save(dir, 'claims.json', claims);
  log(`${clip.id}: ${claims.claims.length} claim(s), stance ${claims.stance}`);
  if (!claims.claims.length) {
    const result: ClipRun = { clipId: clip.id, dir, claims, draft: null, status: 'no_claims', provenance };
    save(dir, 'run.json', { provenance, status: result.status, calls: client.log });
    save(dir, 'report.md', report(clip, result, sources));
    return result;
  }

  // 3. frames ------------------------------------------------------------------
  const crop = await detectCrop(video, p);
  // When every claim names a time, show only frames around those moments: given
  // the whole clip, the VLM boxed everything on the first frame (live run, 2026-11-07).
  const claimTimes = claims.claims.flatMap((c) => (c.t0 !== null ? [c.t0] : []));
  const allTimed = claimTimes.length === claims.claims.length;
  const times = pickTimes(p.duration, claimTimes, { spread: allTimed ? 0 : 8 });
  const frames = await extractFrames(video, p, times, join(dir, 'frames'), { crop });
  provenance.frames = { count: frames.length, times, ...(crop ? { crop } : {}) };
  save(dir, 'frames.json', { probe: p, crop: crop ?? null, frames });

  // 4. draft -------------------------------------------------------------------
  log(`${clip.id}: ${frames.length} frames${crop ? ' (letterbox cropped)' : ''} → ${visionModel}`);
  const content: Content = [
    ...frames.flatMap((f) => [
      { type: 'text' as const, text: `Frame ${f.index} at ${f.t.toFixed(2)}s` },
      { type: 'image_url' as const, image_url: { url: dataUrl(join(dir, 'frames', f.file)) } },
    ]),
    { type: 'text' as const, text: draftPrompt(claims.claims, p.duration) },
  ];
  const draftReq = {
    model: visionModel,
    messages: [
      { role: 'system' as const, content: DRAFT_SYSTEM },
      { role: 'user' as const, content },
    ],
    guided_json: DRAFT_SCHEMA,
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 2500,
  };
  // Save the request without the image bytes.
  save(dir, 'draft.request.json', {
    ...draftReq,
    messages: draftReq.messages.map((m) =>
      Array.isArray(m.content)
        ? { ...m, content: m.content.map((c) => (c.type === 'image_url' ? { type: 'image_url', image_url: { url: '<jpeg omitted>' } } : c)) }
        : m,
    ),
  });
  const draftResp = await client.chat(draftReq);
  save(dir, 'draft.response.json', draftResp);
  served(draftResp, visionModel);
  const draft = validateDraft(completionText(draftResp), {
    duration: p.duration,
    frames,
    crop,
    claims: claims.claims,
    sources,
    model: visionModel,
    allowModelOnly: opts.allowModelOnly,
  });
  // 4b. pixel check on before/after claims (same cropped frames the model saw).
  const gray = await grayFrames(join(dir, 'frames'), frames);
  draft.tells = draft.tells.map((t) => {
    if (!wantsChangeCheck(t)) return t;
    const box = crop ? frameToCrop(t.box!, crop) : t.box!;
    if (!box) return t;
    const direction = t.compareT !== undefined && t.compareT < t.focusT! ? -1 : 1;
    const res = findChange(gray, t.focusT!, box, { direction, maxGap: MAX_COMPARE_GAP });
    const { tell, note } = applyChangeCheck(t, res, p.duration);
    if (note) draft.issues.push(`${t.id}: ${note}`);
    return tell;
  });
  save(dir, 'draft.json', draft);

  // 5. review ------------------------------------------------------------------
  await reviewSheet(video, p, draft.tells, join(dir, 'review.jpg'));
  const result: ClipRun = { clipId: clip.id, dir, claims, draft, status: draft.tells.length ? 'drafted' : 'no_tells', provenance };
  save(dir, 'run.json', { provenance, status: result.status, calls: client.log });
  save(dir, 'report.md', report(clip, result, sources));
  log(`${clip.id}: ${draft.tells.length} tell(s), ${draft.tells.filter((t) => t.box).length} boxed, ${draft.rejected.length} rejected`);
  return result;
}

// ---------------------------------------------------------------------------

/**
 * A client that answers with a clip's saved replies instead of calling NVIDIA,
 * so validation changes can be re-applied to real model output for free.
 */
export function replayClient(dir: string): NimClient {
  const files = ['claims.response.json', 'draft.response.json'];
  let i = 0;
  return {
    log: [],
    models: async () => [],
    chat: async (req) => {
      const f = join(dir, files[i++] ?? 'none');
      if (!existsSync(f)) throw new Error(`no saved reply ${f} to replay`);
      // The served id can differ from the requested one (e.g. "private/…super-120b" for "…super-vl-120b").
      return JSON.parse(readFileSync(f, 'utf8'));
    },
  };
}

export interface PublishResult {
  clipId: string;
  file: string | null;
  tells: Tell[];
  dropped: { label: string; reason: string }[];
  reviewProblems: string[];
}

/** Record a review decision for a clip's current draft (build/annotate/<id>/review.json). */
export function recordReview(paths: Paths, clipId: string, d: Omit<ReviewDecision, 'at'>, now = new Date()): ReviewDecision[] {
  const dir = join(paths.build, 'annotate', clipId);
  const draft = JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')) as DraftResult;
  const tell = draft.tells.find((t) => t.id === d.tell);
  if (!tell) throw new Error(`${clipId} has no drafted tell "${d.tell}"; ids: ${draft.tells.map((t) => t.id).join(', ')}`);
  if (d.action !== 'reject' && d.by !== 'human') throw new Error('only a person can mark a tell checked or verified; agents can only reject');
  if (!d.why.trim()) throw new Error('give a reason (--why)');
  const decisions = readReview(dir).filter((x) => x.tell !== d.tell);
  decisions.push({ ...d, label: tell.label, at: now.toISOString() });
  writeFileSync(join(dir, 'review.json'), JSON.stringify(decisions, null, 1));
  return decisions;
}

function readReview(dir: string): ReviewDecision[] {
  const f = join(dir, 'review.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ReviewDecision[]) : [];
}

/**
 * Publish a clip's validated draft into the demo: merged with hand-checked
 * tells into scripts/harvest/tells/<id>.json (the record in git), copied to a
 * content-addressed file under build/media, and pointed to from the feed.
 */
export function publishClip(paths: Paths, clipId: string): PublishResult {
  const dir = join(paths.build, 'annotate', clipId);
  const draft = JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')) as DraftResult;
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { provenance: Provenance };
  const curatedFile = join(paths.curated, `${clipId}.json`);
  const existing = existsSync(curatedFile) ? readTellsFile(JSON.parse(readFileSync(curatedFile, 'utf8'))).tells : [];
  const reviewed = applyReview(draft.tells, readReview(dir));
  const merged = mergeTells(existing, reviewed.tells);
  const provenance: Provenance = reviewed.applied.length ? { ...run.provenance, review: reviewed.applied } : run.provenance;
  const file = buildTellsFile(merged.tells, provenance, draft.unplaced ?? []);
  mkdirSync(paths.curated, { recursive: true });
  writeFileSync(curatedFile, `${JSON.stringify(file, null, 2)}\n`);
  const name = syncToBuild(paths, clipId, curatedFile);
  return {
    clipId,
    file: name,
    tells: merged.tells,
    dropped: merged.dropped.map((d) => ({ label: d.tell.label, reason: d.reason })),
    reviewProblems: reviewed.problems,
  };
}

/** Copy a clip's tells file into build/media under a content hash and update the feed. Returns the media key. */
export function syncToBuild(paths: Paths, clipId: string, tellsFile: string): string | null {
  const feedPath = join(paths.build, 'feeds', 'demo.json');
  const feed = readFeed(paths);
  const clip = feed.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`${clipId} is not in the demo feed`);
  const bytes = readFileSync(tellsFile);
  const data = readTellsFile(JSON.parse(bytes.toString('utf8')));
  if (!data.tells.length && !data.unplaced?.length) {
    clip.tells = null;
  } else {
    // Same naming as scripts/harvest/build_media.py: sha256 of the file bytes.
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `${dirname(clip.video)}/${tellsFileName(hash)}`;
    const out = join(paths.build, key);
    mkdirSync(dirname(out), { recursive: true });
    if (!existsSync(out)) writeFileSync(out, bytes);
    clip.tells = key;
  }
  writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
  return clip.tells;
}

// ---------------------------------------------------------------------------

function report(clip: FeedClip, r: ClipRun, sources: SourceText[]): string {
  const L: string[] = [];
  L.push(`# ${clip.id}`, '', `Source: ${clip.source?.url ?? 'unknown'}  `, `Status: **${r.status}** · generated ${r.provenance.generatedAt}`, '');
  L.push('> Automatic draft. Community claims and model output are uncertain evidence; nothing here is verified until someone checks the frames.', '');
  L.push('## Inputs', '');
  for (const s of sources) L.push(`- \`${s.ref}\` (${s.kind}${s.url ? `, ${s.url}` : ''}): ${s.text.replace(/\s+/g, ' ').slice(0, 300)}`);
  L.push('', `## Claims (${r.claims.stance})`, '', r.claims.rationale ? `_${r.claims.rationale}_` : '', '');
  for (const c of r.claims.claims) {
    const cov = r.draft?.coverage[c.id];
    L.push(`- **${c.id}** ${c.description} — "${c.quote}" (${c.ref}${c.t0 !== null ? `, ~${c.t0}s` : ''})${cov ? ` → ${cov}` : ''}`);
  }
  const stances = Object.entries(r.claims.commentStances);
  if (stances.length) L.push('', 'Comment stances: ' + stances.map(([k, v]) => `${k}=${v}`).join(', '));
  if (r.draft) {
    L.push('', '## Tells', '');
    for (const t of r.draft.tells) {
      L.push(
        `- **${t.label}** (\`${t.id}\`) [${t.category}] ${t.t0}–${t.t1}s (pause ${t.focusT}s${t.compareT !== undefined ? `, after ${t.compareT}s` : ''}) · ${t.box ? `box x=${t.box.x} y=${t.box.y} w=${t.box.w} h=${t.box.h}` : 'no box'} · ${t.confidence}${t.seenInFrames === false ? ' · not seen in frames' : ''}${t.pixelCheck ? ` · pixel check: ${t.pixelCheck}` : ''}`,
      );
      if (t.detail) L.push(`  ${t.detail}`);
    }
    if (r.draft.unplaced?.length) {
      L.push('', '## Also claimed (not placed on the video)', '');
      for (const u of r.draft.unplaced) L.push(`- "${u.quote}" (${u.from}, ${u.reason})`);
    }
    if (r.draft.rejected.length) {
      L.push('', '## Rejected', '');
      for (const x of r.draft.rejected) L.push(`- ${x.reason}`);
    }
  }
  const issues = [...r.claims.issues, ...(r.draft?.issues ?? [])];
  if (issues.length) {
    L.push('', '## Repairs and warnings', '');
    for (const i of issues) L.push(`- ${i}`);
  }
  if (r.draft?.tells.some((t) => t.box)) L.push('', '![review](review.jpg)');
  return `${L.join('\n')}\n`;
}
