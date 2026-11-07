/**
 * Upload the pipeline's build/ folder to R2.
 *
 *   node scripts/publish.ts --local              seed the bucket `wrangler dev` uses
 *   node scripts/publish.ts --remote             upload media + feeds to Cloudflare
 *   node scripts/publish.ts --remote --archive   also upload the private evidence archive
 *
 * Media paths are versioned (v1/, v2/...), so uploads never overwrite a file
 * a client may have cached; only feeds/*.json changes between publishes.
 */
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BUCKET = 'double-take-media';
const BUILD = resolve(import.meta.dirname, '../../build');
const args = new Set(process.argv.slice(2));
const target = args.has('--remote') ? '--remote' : args.has('--local') ? '--local' : null;
if (!target) {
  console.error('usage: node scripts/publish.ts --local|--remote [--archive]');
  process.exit(2);
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.webm': 'video/webm',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const prefixes = ['media', 'feeds', ...(args.has('--archive') ? ['archive'] : [])];
const files = prefixes.flatMap((p) => {
  try {
    return walk(join(BUILD, p));
  } catch {
    return [];
  }
});
if (!files.length) {
  console.error(`nothing to publish under ${BUILD}; run scripts/harvest/build_media.py first`);
  process.exit(1);
}

async function put(file: string): Promise<void> {
  const key = relative(BUILD, file).split('\\').join('/');
  const cache = key.startsWith('feeds/') ? 'no-cache' : 'public, max-age=31536000, immutable';
  await run(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, target!,
      '--content-type', TYPES[extname(file)] ?? 'application/octet-stream', '--cache-control', cache],
    { cwd: resolve(import.meta.dirname, '..'), maxBuffer: 1 << 24 },
  );
  console.log(`${target} ${key}`);
}

// Feeds last, so a feed never points at media that is not uploaded yet.
const [media, feeds] = [files.filter((f) => !f.includes('/feeds/')), files.filter((f) => f.includes('/feeds/'))];
const queue = [...media];
const workers = Array.from({ length: target === '--remote' ? 6 : 1 }, async () => {
  for (let f = queue.shift(); f; f = queue.shift()) await put(f);
});
await Promise.all(workers);
for (const f of feeds) await put(f);
console.log(`published ${files.length} files (${target})`);
