import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import type { DemoCheck } from '@/demo/lookup';
import { mediaUrl, type ClientJob } from '../investigation/client';
import { validateJobResponse } from '../investigation/client-config';
import { Sha256 } from './sha256';

/*
 * Prepared checks for the stage demo (`@/demo/lookup`). A picked file (by its
 * SHA-256) or a pasted post link can match a check stored in the cloud; the
 * Create flow then plays its usual upload → check → result with that stored
 * result, so a live demo doesn't depend on the job runner. Anything that
 * goes wrong here counts as "no match": the normal path runs instead.
 */

const CHUNK = 2 * 1024 * 1024;
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/** The file's SHA-256 (hex), read in chunks with a breath between them so the UI keeps moving. */
export async function hashAsset(asset: DocumentPickerAsset): Promise<string> {
  const h = new Sha256();
  if (Platform.OS === 'web') {
    const file = asset.file;
    if (!file) throw new Error('no file');
    for (let at = 0; at < file.size; at += CHUNK) {
      h.update(new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer()));
      await breathe();
    }
    return h.hex();
  }
  const handle = new File(asset.uri).open();
  try {
    for (;;) {
      const bytes = await handle.readBytes(CHUNK);
      if (!bytes.length) break;
      h.update(bytes);
      await breathe();
    }
  } finally {
    handle.close();
  }
  return h.hex();
}

/** A prepared check's stored job, validated like any job reply, with where its video plays from; null if it doesn't hold up. */
export function preparedJob(check: DemoCheck | null): { job: ClientJob; mediaUrl: string } | null {
  if (!check) return null;
  const job = check.job as ClientJob | null;
  try {
    validateJobResponse(job, (job as { id?: string } | null)?.id ?? '', true);
  } catch {
    return null;
  }
  if (!job || job.state !== 'complete' || !job.result) return null;
  return { job, mediaUrl: check.mediaUrl ?? mediaUrl(job.id, true) };
}
