/**
 * Prepare build/ to be uploaded as Worker static assets:
 *  - keep the private evidence archive (and junk) out of the upload
 *  - write asset-manifest.json with each servable file's size, type and content
 *    hash (the assets binding does not report sizes, and players need them to seek)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const BUILD = resolve(import.meta.dirname, '../../build');
const FEED = join(BUILD, 'feeds', 'demo.json');
if (!existsSync(FEED)) {
  console.error(`missing ${FEED}; run scripts/harvest/build_media.py first`);
  process.exit(1);
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

const manifest: Record<string, { size: number; etag: string; contentType: string }> = {};
for (const file of walk(join(BUILD, 'media'))) {
  if (file.endsWith('.DS_Store')) continue;
  const key = relative(BUILD, file).split('\\').join('/');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 32);
  manifest[key] = {
    size: statSync(file).size,
    etag: `"${hash}"`,
    contentType: TYPES[extname(file)] ?? 'application/octet-stream',
  };
}

writeFileSync(join(BUILD, 'asset-manifest.json'), JSON.stringify(manifest));
// annotate/ holds the tells pipeline's working files (frames, model replies); only tells.*.json under media/ ships.
writeFileSync(join(BUILD, '.assetsignore'), 'archive/\nannotate/\n.DS_Store\n*.part\n');
console.log(`staged ${Object.keys(manifest).length} media files from ${BUILD}`);
