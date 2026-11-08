/**
 * Load prepared stage-demo checks into Supabase: uploads each check's video to
 * the public `demo-media` bucket and upserts its row in `demo_checks` (by id,
 * so re-running a bundle updates it). The app finds them with
 * `lookupDemoCheck` (src/demo/lookup.ts).
 *
 *   node scripts/demo/import-demo-checks.ts <bundle-dir> [--dry-run] [--env <file>]
 *
 * <bundle-dir> holds index.json (format in bundle.ts; the hill's stage-export-v1
 * bundle as is) and the media/result/job files it names. Nothing is sent unless
 * the whole bundle checks out (paths, sizes, SHA-256s, job envelopes). The secret key comes from a private env file, never the app:
 * SUPABASE_URL and SUPABASE_SECRET_KEY, read from --env, else
 * scripts/demo/.env.local, else worker/.dev.vars. Nothing secret is printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mediaPath, mediaType, parseBundle, type BundleCheck } from './bundle.ts';

const BUCKET = 'demo-media';
const MAX_BYTES = 50 * 1024 * 1024; // the bucket's limit (free plan)
const ROOT = resolve(import.meta.dirname, '../..');

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error('usage: node scripts/demo/import-demo-checks.ts <bundle-dir> [--dry-run] [--env <file>]');
  process.exit(2);
}

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function credentials(explicit: string | null): { url: string; key: string; from: string } {
  const candidates = explicit ? [explicit] : [join(ROOT, 'scripts/demo/.env.local'), join(ROOT, 'worker/.dev.vars')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const env = readEnv(file);
    if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
      return { url: env.SUPABASE_URL.replace(/\/+$/, ''), key: env.SUPABASE_SECRET_KEY, from: file };
    }
  }
  usage(`No SUPABASE_URL and SUPABASE_SECRET_KEY in ${candidates.join(' or ')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const envAt = args.indexOf('--env');
  const envFile = envAt >= 0 ? (args[envAt + 1] ?? usage('--env needs a file')) : null;
  const dir = args.find((a, i) => !a.startsWith('--') && !(envAt >= 0 && i === envAt + 1));
  if (!dir) usage();
  const bundle = resolve(dir);
  const indexFile = join(bundle, 'index.json');
  if (!existsSync(indexFile)) usage(`No index.json in ${bundle}`);

  const { checks, problems } = parseBundle(JSON.parse(readFileSync(indexFile, 'utf8')));
  // Everything is checked before anything is sent: files exist, videos fit the
  // bucket and match their declared SHA-256, and a job envelope matches its result.
  const hashes = new Map<string, string>();
  const hashOf = (file: string) => {
    if (!hashes.has(file)) hashes.set(file, createHash('sha256').update(readFileSync(file)).digest('hex'));
    return hashes.get(file)!;
  };
  const readJson = (c: BundleCheck, f: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(bundle, f), 'utf8'));
    } catch (e) {
      problems.push(`${c.id}: can't read ${f} (${e instanceof Error ? e.message : e})`);
      return null;
    }
  };
  const rows = checks.flatMap((c: BundleCheck) => {
    const missing = [c.media, c.resultFile, c.jobFile].filter((f): f is string => !!f && !existsSync(join(bundle, f)));
    if (missing.length) {
      problems.push(`${c.id}: missing ${missing.join(', ')}`);
      return [];
    }
    const mediaFile = c.media ? join(bundle, c.media) : null;
    if (mediaFile && statSync(mediaFile).size > MAX_BYTES) problems.push(`${c.id}: ${c.media} is over 50 MB`);
    const actual = mediaFile ? hashOf(mediaFile) : null;
    if (actual && c.sha256 && actual !== c.sha256) problems.push(`${c.id}: ${c.media} doesn't match its sha256`);
    const videoSha = c.sha256 ?? actual;
    const result = c.result ?? (c.resultFile ? readJson(c, c.resultFile) : null);
    const job = c.jobFile ? readJson(c, c.jobFile) : null;
    if (job && JSON.stringify((job as { result?: unknown }).result) !== JSON.stringify(result)) {
      problems.push(`${c.id}: ${c.jobFile}'s result isn't the row's result`);
    }
    return [
      {
        c,
        mediaFile,
        row: {
          id: c.id,
          kind: c.kind,
          // Only file rows are looked up by hash; link rows share the video.
          sha256: c.kind === 'file' ? videoSha : null,
          normalized_url: c.normalizedUrl,
          label: c.label,
          result,
          job,
          media_path: mediaFile && videoSha ? mediaPath(mediaFile, videoSha) : null,
          media_sha256: videoSha,
          reference: c.reference,
        },
      },
    ];
  });
  if (problems.length) {
    console.error(`The bundle has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  for (const { row } of rows) {
    console.log(
      `${dryRun ? '[dry run] ' : ''}${row.id}: ${row.kind} ${row.kind === 'file' ? row.sha256 : row.normalized_url}${row.media_path ? ` → ${row.media_path}` : ''}`,
    );
  }
  if (dryRun) return;

  const { url, key, from } = credentials(envFile);
  console.log(`Using the Supabase secret key from ${from.replace(ROOT + '/', '')}`);
  const headers = { apikey: key, authorization: `Bearer ${key}` };

  // Each video once, however many rows share it (x-upsert: re-runs replace it).
  const uploads = new Map<string, string>();
  for (const { mediaFile, row } of rows) if (mediaFile && row.media_path) uploads.set(row.media_path, mediaFile);
  for (const [path, file] of uploads) {
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': mediaType(file)!, 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
      body: readFileSync(file),
    });
    if (!res.ok) throw new Error(`upload of ${path} failed (${res.status}) ${(await res.text()).slice(0, 200)}`);
    console.log(`uploaded ${path}`);
  }
  // Upsert by id: re-running a bundle (or a newer one with the same ids) updates the rows.
  const res = await fetch(`${url}/rest/v1/demo_checks?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.map((r) => r.row)),
  });
  if (!res.ok) throw new Error(`saving rows failed (${res.status}) ${(await res.text()).slice(0, 300)}`);
  console.log(`Imported ${rows.length} row(s) from ${dirname(indexFile)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
