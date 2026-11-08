/**
 * What the review site shows: every clip from the Worker's feeds and the harvest's
 * candidate batches, merged into one item per stable clip key (build_media.py's
 * `clip_id`: x-<status id>, yt-<video id>, u-<url hash>).
 *
 * Generic on purpose: any feed name, any batch file, any label or tier, and the
 * comparison fields (`tier`, `pairOf`, `how`) pass through when a row has them.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Same as build_media.py's clip_id; the key decisions are stored under. */
export function clipId(url: string): string {
  let m = url.match(/(?:x|twitter)\.com\/.*\/status\/(\d+)/);
  if (m) return `x-${m[1]}`;
  m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `yt-${m[1]}`;
  m = url.match(/reddit\.com\/r\/\w+\/comments\/(\w+)/);
  if (m) return `rd-${m[1]}`;
  return 'u-' + createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** When an X post was made, from its snowflake id (ms since epoch). */
export function snowflakeTime(key: string): number | undefined {
  const m = key.match(/^x-(\d{15,20})$/);
  if (!m) return undefined;
  const ms = Number((BigInt(m[1]) >> 22n) + 1288834974657n);
  return ms > Date.UTC(2010, 0) && ms < Date.UTC(2100, 0) ? ms : undefined;
}

export interface Membership {
  kind: 'feed' | 'batch';
  /** For feeds: which Worker served it ("prod", "local"). */
  source?: string;
  name: string;
  /** Position in that feed or file. */
  index: number;
}

/** A subreddit thread's verdict (pick_reddit.py / consensus.py). */
export interface Consensus {
  verdict: 'ai' | 'real' | 'unsure';
  confidence: number;
  ai: number;
  real: number;
  voters: number;
  flair?: string | null;
  flairVerdict?: string | null;
  evidence: { stance?: string | null; score: number; text: string; permalink?: string | null; mod?: boolean }[];
  tells: { tell: string; count: number }[];
}

export interface Thread {
  sub?: string;
  url?: string;
  title?: string;
  flair?: string | null;
  score?: number;
  comments?: number;
  created?: number;
}

export interface Note {
  url?: string;
  status?: string;
  text?: string;
  createdAtMillis?: number;
}

/** What a label claims: an AI clip, real footage, CGI/animation, or unknown. */
export type Kind = 'ai' | 'real' | 'cgi' | 'unknown';
export function kindOf(label: string | undefined, tier: string | undefined): Kind {
  const l = (label ?? '').trim().toLowerCase();
  if (l === 'confirmed' || l === 'ai') return 'ai';
  if (/cgi/.test(l) || /cgi/.test(tier ?? '')) return 'cgi';
  if (l === 'real' || l === 'not_ai' || l === 'authentic' || (tier ?? '').startsWith('real-')) return 'real';
  return 'unknown';
}

export interface Item {
  key: string;
  kind: Kind;
  url?: string;
  platform?: string;
  author?: string | null;
  title?: string | null;
  views?: number | null;
  likes?: number | null;
  /** The first label seen (feeds first); `labels` lists every distinct one. */
  label?: string;
  labels: string[];
  tier?: string;
  pairOf?: string;
  /** Keys of clips whose `pairOf` is this one. */
  partners: string[];
  how?: string;
  section?: string;
  evidence?: string;
  note?: Note;
  /** Reddit rows: the thread and its scored consensus. */
  consensus?: Consensus;
  thread?: Thread;
  media?: {
    video: string;
    poster: string;
    tile?: string;
    width: number;
    height: number;
    duration: number;
    sha256?: string;
    tells: { name: string; url: string }[];
  };
  in: Membership[];
  /** Post time in ms, when known. */
  date?: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Read a JSONL file's object rows, skipping blank and malformed lines. */
export function readJsonl(path: string): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && !Array.isArray(r)) rows.push(r);
    } catch {
      // skip
    }
  }
  return rows;
}

/** Candidate batch files: every *.jsonl in the harvest folder whose rows have a url. */
export function batchFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => join(dir, f));
}

export class Catalog {
  private items = new Map<string, Item>();

  private item(key: string): Item {
    let it = this.items.get(key);
    if (!it) {
      it = { key, kind: 'unknown', labels: [], partners: [], in: [], date: snowflakeTime(key) };
      this.items.set(key, it);
    }
    return it;
  }

  /** Fill fields from a feed or batch row, keeping what an earlier source already set. */
  private fill(it: Item, r: Row) {
    const src = (r.source && typeof r.source === 'object' ? r.source : {}) as Row;
    it.url ??= str(src.url) ?? str(r.url);
    it.platform ??= str(src.platform) ?? it.key.split('-')[0];
    it.author ??= str(src.author) ?? str(r.uploader);
    it.title ??= str(src.title);
    it.views ??= num(src.views) ?? num(r.views);
    it.likes ??= num(src.likes) ?? num(r.likes);
    const label = str(r.label);
    if (label) {
      it.label ??= label;
      if (!it.labels.includes(label)) it.labels.push(label);
    }
    it.tier ??= str(r.tier);
    it.pairOf ??= str(r.pairOf);
    it.how ??= str(r.how);
    it.section ??= str(r.section);
    it.evidence ??= str(r.evidence);
    if (!it.note && r.note && typeof r.note === 'object') it.note = r.note as Note;
    if (!it.consensus && r.consensus && typeof r.consensus === 'object') it.consensus = r.consensus as Consensus;
    if (!it.thread && r.thread && typeof r.thread === 'object') it.thread = r.thread as Thread;
  }

  /**
   * Add a feed as a Worker's `/feed?name=…` returns it (signed media URLs). Media
   * comes from the first source added that has the clip, so add prod first.
   */
  addFeed(source: string, name: string, clips: Row[]) {
    clips.forEach((c, index) => {
      const key = str(c.id);
      const video = str(c.video);
      const poster = str(c.poster);
      if (!key || !video || !poster) return;
      const it = this.item(key);
      it.in.push({ kind: 'feed', source, name, index });
      this.fill(it, c);
      if (!it.media) {
        const tells = str(c.tells) ? [{ name: 'main', url: c.tells as string }] : [];
        if (c.tellsAlt && typeof c.tellsAlt === 'object') {
          for (const [n, u] of Object.entries(c.tellsAlt as Row)) if (str(u) && n !== 'main') tells.push({ name: n, url: u as string });
        }
        it.media = {
          video,
          poster,
          tile: str(c.tile),
          width: num(c.width) ?? 0,
          height: num(c.height) ?? 0,
          duration: num(c.duration) ?? 0,
          sha256: str(c.sha256),
          tells,
        };
      }
    });
  }

  /** Add a candidate batch file's rows (`{url, label, evidence, …}`). */
  addBatch(name: string, rows: Row[]) {
    rows.forEach((r, index) => {
      const url = str(r.url);
      if (!url) return;
      const it = this.item(clipId(url));
      if (!it.in.some((m) => m.kind === 'batch' && m.name === name)) it.in.push({ kind: 'batch', name, index });
      this.fill(it, r);
    });
  }

  /** Attach Community Notes (scripts/annotate/notes.jsonl rows) to their X clips. */
  addNotes(rows: Row[]) {
    for (const r of rows) {
      const id = str(r.tweetId);
      const it = id && this.items.get(`x-${id}`);
      if (!it) continue;
      it.note ??= { url: str(r.url), status: str(r.status), text: str(r.text), createdAtMillis: num(r.createdAtMillis) };
    }
  }

  list(): Item[] {
    const all = [...this.items.values()];
    for (const it of all) it.partners = [];
    for (const it of all) if (it.pairOf) this.items.get(it.pairOf)?.partners.push(it.key);
    for (const it of all) {
      it.date ??= it.note?.createdAtMillis ?? (it.thread?.created ? it.thread.created * 1000 : undefined);
      it.kind = kindOf(it.label, it.tier);
    }
    return all;
  }
}


/** Point a local Worker's media URLs (http://localhost:8787/m/…) at the host the browser used. */
export function rehost(clips: Row[], browserHost: string): Row[] {
  const swap = (v: unknown) => {
    if (typeof v !== 'string') return v;
    try {
      const u = new URL(v);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return v;
      u.hostname = browserHost;
      return u.toString();
    } catch {
      return v;
    }
  };
  return clips.map((c) => {
    const out: Row = { ...c };
    for (const k of ['video', 'poster', 'tile', 'tells']) out[k] = swap(c[k]);
    if (c.tellsAlt && typeof c.tellsAlt === 'object')
      out.tellsAlt = Object.fromEntries(Object.entries(c.tellsAlt as Row).map(([n, u]) => [n, swap(u)]));
    return out;
  });
}

/** Batch file name as shown in the UI: "batch-2026-11-07b". */
export const batchName = (path: string) => basename(path, '.jsonl');
