/** Navigation commits only after the server confirms it stored this upload. */
export async function acceptUpload<T extends { id: string; state: string }>(id: string, send: () => Promise<T>, accepted: (job: T) => void): Promise<T> {
  const job = await send();
  if (job.id !== id || !['queued', 'running', 'complete', 'error'].includes(job.state)) throw new Error('Upload was not confirmed. Choose the video again to retry.');
  accepted(job);
  return job;
}
/** Ignore late replies after a new selection, navigation, or unmount. */
export class UploadGeneration {
  private current = 0;
  next() { return ++this.current; }
  isCurrent(value: number) { return this.current === value; }
}
/** A missing acknowledgement is ambiguous: read the same key before offering a retry. */
export async function sendOrRecover<T>(send: () => Promise<T>, recover: () => Promise<T>): Promise<T> {
  try { return await send(); }
  catch (error) { try { return await recover(); } catch { throw error; } }
}
export function uploadRoute(params: { job?: unknown; pending?: unknown; prepared?: unknown }) {
  const valid = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s) ? s : undefined;
  return { id: valid(params.job), pendingId: valid(params.pending), prepared: params.prepared === '1' };
}
