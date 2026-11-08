/**
 * Dev-only clip review site: a local server for triaging the gallery.
 *
 *   npm run review                       (http://0.0.0.0:8090, reachable over the tailnet)
 *   npm run review -- --port 8091 --host 127.0.0.1
 *
 * It lives outside src/, so Metro never bundles it and nothing deploys it. It reads
 * the deployed Worker's feeds server side (the passcode never reaches the browser,
 * only the signed media URLs the app already gets), the candidate batches in
 * scripts/harvest/*.jsonl and the notes in scripts/annotate/notes.jsonl, and appends
 * decisions to scripts/harvest/review/decisions.jsonl for build_media.py.
 *
 * Sources, in priority order (a clip's media comes from the first that has it):
 *   prod   the deployed Worker: EXPO_PUBLIC_API_URL + EXPO_PUBLIC_DEMO_PASSCODE from
 *          .env.local (or DEMO_PASSCODE from worker/.prod.vars)
 *   local  a `wrangler dev` Worker serving the Mac-style build/: http://localhost:8787
 *          with DEMO_PASSCODE from worker/.dev.vars. Its signed URLs are rewritten to
 *          the host the browser used, so they play over the tailnet too.
 * Each serves feeds demo and compare; a missing feed or Worker is shown, not fatal.
 * Overrides: REVIEW_SOURCES=prod,local  REVIEW_FEEDS=demo,compare
 *            REVIEW_PROD_URL / REVIEW_PROD_PASSCODE  REVIEW_LOCAL_URL / REVIEW_LOCAL_PASSCODE
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Catalog, batchFiles, batchName, readJsonl, rehost, type Item } from './catalog.ts';
import { DecisionLog, checkPatch, fold, type Patch } from './decisions.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const HARVEST = join(ROOT, 'scripts', 'harvest');
const REVIEW_DIR = join(HARVEST, 'review');
const PUBLIC = join(import.meta.dirname, 'public');
const TAGS_PATH = join(REVIEW_DIR, 'tags.json');
const NOTES_PATH = join(ROOT, 'scripts', 'annotate', 'notes.jsonl');

if (process.env.NODE_ENV === 'production') {
  console.error('The review site is a dev tool; refusing to run with NODE_ENV=production.');
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.REVIEW_PORT ?? '8090' },
    host: { type: 'string', default: process.env.REVIEW_HOST ?? '0.0.0.0' },
  },
});

function dotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const appEnv = dotenv(join(ROOT, '.env.local'));
const prodVars = dotenv(join(ROOT, 'worker', '.prod.vars'));
const devVars = dotenv(join(ROOT, 'worker', '.dev.vars'));
const list = (v: string | undefined, d: string) =>
  (v ?? d)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^[\w-]+$/.test(x));
const FEEDS = list(process.env.REVIEW_FEEDS, 'demo,compare');

interface Source {
  name: string;
  url: string;
  passcode: string;
  /** Rewrite media URLs to the browser's host (a Worker reached on localhost). */
  rehost: boolean;
}
const ALL_SOURCES: Source[] = [
  {
    name: 'prod',
    url: process.env.REVIEW_PROD_URL ?? appEnv.EXPO_PUBLIC_API_URL ?? '',
    passcode: process.env.REVIEW_PROD_PASSCODE ?? appEnv.EXPO_PUBLIC_DEMO_PASSCODE ?? prodVars.DEMO_PASSCODE ?? '',
    rehost: false,
  },
  {
    name: 'local',
    url: process.env.REVIEW_LOCAL_URL ?? 'http://localhost:8787',
    passcode: process.env.REVIEW_LOCAL_PASSCODE ?? devVars.DEMO_PASSCODE ?? '',
    rehost: true,
  },
];
const wanted = list(process.env.REVIEW_SOURCES, 'prod,local');
const SOURCES = ALL_SOURCES.filter((s) => wanted.includes(s.name)).map((s) => ({ ...s, url: s.url.replace(/\/+$/, '') }));

const log = new DecisionLog(join(REVIEW_DIR, 'decisions.jsonl'));

interface FeedStatus {
  source: string;
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}
type Row = Record<string, unknown>;
interface Loaded {
  status: FeedStatus;
  clips: Row[];
  rehost: boolean;
}

/** Feeds are cached for 10 minutes (signed URLs last a day); ?refresh=1 refetches. */
let feedCache: { at: number; feeds: Loaded[] } | null = null;

async function fetchFeed(src: Source, name: string): Promise<Loaded> {
  const fail = (error: string) => ({ status: { source: src.name, name, ok: false, count: 0, error }, clips: [], rehost: src.rehost });
  if (!src.url || !src.passcode) return fail('no URL or passcode configured');
  try {
    const res = await fetch(`${src.url}/feed?name=${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${src.passcode}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const body = (await res.json()) as { clips?: Row[] };
    const clips = Array.isArray(body.clips) ? body.clips : [];
    return { status: { source: src.name, name, ok: true, count: clips.length }, clips, rehost: src.rehost };
  } catch (e) {
    return fail(e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : String((e as Error).cause ?? e));
  }
}

async function loadFeeds(refresh: boolean) {
  if (!refresh && feedCache && Date.now() - feedCache.at < 10 * 60_000) return feedCache.feeds;
  const feeds = await Promise.all(SOURCES.flatMap((src) => FEEDS.map((name) => fetchFeed(src, name))));
  feedCache = { at: Date.now(), feeds };
  return feeds;
}

async function catalog(refresh: boolean, browserHost: string) {
  const cat = new Catalog();
  const feeds = await loadFeeds(refresh);
  for (const f of feeds) cat.addFeed(f.status.source, f.status.name, f.rehost ? rehost(f.clips, browserHost) : f.clips);
  const batches = batchFiles(HARVEST).map((path) => {
    const rows = readJsonl(path).filter((r) => typeof r.url === 'string');
    cat.addBatch(batchName(path), rows);
    return { name: batchName(path), count: rows.length };
  });
  if (existsSync(NOTES_PATH)) cat.addNotes(readJsonl(NOTES_PATH));
  const items: Item[] = cat.list();
  return { items, feeds: feeds.map((f) => f.status), batches, generatedAt: new Date().toISOString() };
}

const DEFAULT_TAGS = [
  'wrong label',
  'mixed real+AI',
  'political/person',
  'low quality',
  'duplicate/repost',
  'bad tells',
  'great example',
];

function readTags(): string[] {
  try {
    const t = JSON.parse(readFileSync(TAGS_PATH, 'utf8'));
    if (Array.isArray(t) && t.every((s) => typeof s === 'string')) return t;
  } catch {
    // fall back
  }
  return DEFAULT_TAGS;
}

function decisionsBody() {
  const { events, skipped } = log.read();
  return { states: Object.fromEntries(fold(events)), events: events.length, skipped };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64_000) throw new Error('body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const cleanBy = (by: unknown) => (typeof by === 'string' && by.trim() ? by.trim().slice(0, 40) : 'anon');

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/catalog') {
    const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
    return send(res, 200, await catalog(url.searchParams.has('refresh'), host));
  }
  if (req.method === 'GET' && p === '/api/decisions') return send(res, 200, decisionsBody());
  if (req.method === 'GET' && p === '/api/tags') return send(res, 200, { tags: readTags() });

  if (req.method === 'PUT' && p === '/api/tags') {
    const body = (await readBody(req)) as { tags?: unknown };
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((t) => String(t).trim()).filter(Boolean))] : null;
    if (!tags || tags.some((t) => t.length > 60)) return send(res, 400, { error: 'tags must be short strings' });
    writeFileSync(TAGS_PATH, JSON.stringify(tags, null, 2) + '\n');
    return send(res, 200, { tags });
  }

  if (req.method === 'POST' && p === '/api/events') {
    const body = (await readBody(req)) as { key?: unknown; set?: Patch; undo?: unknown; by?: unknown; url?: unknown };
    const key = typeof body.key === 'string' && /^[\w-]{1,80}$/.test(body.key) ? body.key : null;
    if (!key) return send(res, 400, { error: 'bad key' });
    const by = cleanBy(body.by);
    let event;
    if (typeof body.undo === 'string') {
      const { events } = log.read();
      const target = events.find((e) => e.id === body.undo);
      if (!target || !('set' in target) || target.key !== key) return send(res, 400, { error: 'nothing to undo' });
      if (events.some((e) => 'undo' in e && e.undo === target.id)) return send(res, 409, { error: 'already undone' });
      event = log.append({ key, by, undo: target.id });
    } else {
      const err = checkPatch(body.set);
      if (err) return send(res, 400, { error: err });
      event = log.append({ key, by, set: body.set as Patch, ...(typeof body.url === 'string' ? { url: body.url } : {}) });
    }
    const state = log.states().get(key) ?? null;
    return send(res, 200, { event, state });
  }

  if (req.method === 'GET') {
    const file = p === '/' ? 'index.html' : p.slice(1);
    if (/^[\w-]+\.(html|js|css)$/.test(file) && existsSync(join(PUBLIC, file))) {
      res.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-cache' });
      return res.end(readFileSync(join(PUBLIC, file)));
    }
  }
  send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e) });
  });
}).listen(Number(args.port), args.host, () => {
  console.log(`clip review on http://${args.host}:${args.port}/  (sources: ${SOURCES.map((x) => x.name).join(', ')}; feeds: ${FEEDS.join(', ')}; decisions: ${log.path})`);
});
