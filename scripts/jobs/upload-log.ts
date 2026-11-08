import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface UploadEvent {
  id: string; event: 'received' | 'accepted' | 'rejected'; at: string; stage: string;
  bytes?: number; sha256?: string; contentType?: string;
  code?: string; error?: string; details?: Record<string, unknown>;
}
// Local private diagnostics survive both rejected-payload cleanup and runner restarts.
// Never record original filenames, URLs, cookies or arbitrary media metadata.
export async function recordUpload(root: string, event: UploadEvent) {
  await appendFile(join(root, 'upload-events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
  if (event.event === 'rejected') {
    const dir = join(root, 'rejections'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, event.id + '.json');
    await writeFile(path + '.tmp', JSON.stringify(event), { mode: 0o600 });
    await rename(path + '.tmp', path);
  }
}
export function publicRejection(event: UploadEvent) {
  return { error: event.error, code: event.code, requestId: event.id,
    ...(typeof event.details?.duration === 'number' ? { duration: event.details.duration } : {}),
    ...(typeof event.details?.maxDuration === 'number' ? { maxDuration: event.details.maxDuration } : {}) };
}
export async function readRejection(root: string, id: string) {
  try { return publicRejection(JSON.parse(await readFile(join(root, 'rejections', id + '.json'), 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
