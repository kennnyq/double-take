/**
 * A demo bundle's index.json, checked before anything is uploaded. Pure, for
 * `node --test`; the I/O is in import-demo-checks.ts.
 *
 * The hill climb's portable stage bundle (stage-export-v1):
 *   { "normalizationVersion": "prepared-source-url-v1", "items": [ {
 *       "id": "tornado-dog-file",            // [A-Za-z0-9_-], 1–64; the row id (re-imports update it)
 *       "kind": "file" | "link",
 *       "sha256": "…64 hex…",                // the video's SHA-256 (link rows share their file's video)
 *       "url": "https://x.com/…",            // link rows; stored normalized (prepared-source-url-v1)
 *       "normalizedUrl": "https://x.com/i/status/…",  // optional; must match our normalization
 *       "label": "ai" | "real",              // the reference label (provenance, not the verdict)
 *       "result": { … } | "resultFile": "…", // GET /jobs/<id>.result
 *       "jobFile": "jobs/….json",            // optional: the full GET envelope
 *       "mediaFile": "media/<sha>.mp4",      // optional; "media" works too
 *       "reference": { … }                   // optional provenance
 *   } ] }
 * "checks" works in place of "items", and a bare array too.
 */
import { DEMO_URL_VERSION, normalizeDemoUrl } from '../../src/demo/demoUrl.ts';

export interface BundleCheck {
  id: string;
  kind: 'file' | 'link';
  /** The video's SHA-256 as declared (verified against the media file when there is one). */
  sha256: string | null;
  normalizedUrl: string | null;
  label: string;
  result: unknown;
  resultFile: string | null;
  jobFile: string | null;
  media: string | null;
  reference: unknown;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;
/** A plain relative path inside the bundle: no `..`, no absolute paths. */
const REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w ./-]{1,200}$/;

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function mediaType(file: string): string | null {
  return MEDIA_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

const relOrNull = (v: unknown) => (v == null ? null : String(v));

/** The checks in an index.json, or a list of what's wrong with it. */
export function parseBundle(index: unknown): { checks: BundleCheck[]; problems: string[] } {
  const o = index as { items?: unknown; checks?: unknown; normalizationVersion?: unknown } | null;
  const list = Array.isArray(index) ? index : (o?.items ?? o?.checks);
  if (!Array.isArray(list)) return { checks: [], problems: ['index.json needs an "items" array'] };
  const problems: string[] = [];
  if (o && !Array.isArray(index) && o.normalizationVersion != null && o.normalizationVersion !== DEMO_URL_VERSION) {
    problems.push(`normalizationVersion ${String(o.normalizationVersion)} isn't ${DEMO_URL_VERSION}`);
  }
  const checks: BundleCheck[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const where = `items[${i}]${typeof c.id === 'string' ? ` (${c.id})` : ''}`;
    const bad = (msg: string) => problems.push(`${where}: ${msg}`);
    if (typeof c.id !== 'string' || !ID.test(c.id)) return bad('id must be 1–64 of A-Z a-z 0-9 _ -');
    if (seen.has(c.id)) return bad('duplicate id');
    seen.add(c.id);
    if (c.kind !== 'file' && c.kind !== 'link') return bad('kind must be "file" or "link"');
    const media = relOrNull(c.mediaFile ?? c.media);
    if (media !== null && (!REL.test(media) || !mediaType(media))) return bad('mediaFile must be a relative .mp4/.mov/.webm/.jpg/.png/.webp path');
    const sha256 = typeof c.sha256 === 'string' ? c.sha256.toLowerCase() : null;
    if (sha256 !== null && !SHA.test(sha256)) return bad('sha256 must be 64 hex characters');
    if (c.kind === 'file' && !sha256 && !media) return bad('a file row needs sha256 or a mediaFile to hash');
    const normalizedUrl = typeof c.url === 'string' ? normalizeDemoUrl(c.url) : null;
    if (c.kind === 'link' && !normalizedUrl) return bad('a link row needs a valid url');
    if (c.kind === 'link' && typeof c.normalizedUrl === 'string' && c.normalizedUrl !== normalizedUrl) {
      return bad(`normalizedUrl ${c.normalizedUrl} isn't ${normalizedUrl} (${DEMO_URL_VERSION})`);
    }
    const resultFile = relOrNull(c.resultFile);
    const jobFile = relOrNull(c.jobFile);
    for (const f of [resultFile, jobFile]) if (f !== null && !REL.test(f)) return bad(`${f} must be a relative path`);
    const hasResult = c.result !== undefined && c.result !== null;
    if (hasResult === (resultFile !== null)) return bad('give exactly one of result or resultFile');
    if (hasResult && (typeof c.result !== 'object' || Array.isArray(c.result))) return bad('result must be an object');
    checks.push({
      id: c.id,
      kind: c.kind,
      sha256,
      normalizedUrl: c.kind === 'link' ? normalizedUrl : null,
      label: typeof c.label === 'string' ? c.label.slice(0, 200) : '',
      result: hasResult ? c.result : null,
      resultFile,
      jobFile,
      media,
      reference: c.reference ?? null,
    });
  });
  return { checks, problems };
}

/**
 * Where a video goes in the demo-media bucket: by its SHA-256, so rows that
 * share a video (a file and its link aliases) share one object.
 */
export function mediaPath(media: string, sha256: string): string {
  return `${sha256}.${media.split('.').pop()!.toLowerCase()}`;
}
