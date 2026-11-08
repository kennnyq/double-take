import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptUpload, sendOrRecover, uploadRoute, UploadGeneration } from './upload-flow.ts';
const id = 'a'.repeat(64);
test('slow or rejected PUT never navigates to an unstored job; successful PUT commits once', async () => {
  let resolve!: (job: { id: string; state: string }) => void;
  const committed: string[] = [];
  const waiting = acceptUpload(id, () => new Promise<{ id: string; state: string }>(done => { resolve = done; }), job => { committed.push(job.id); });
  assert.equal(committed.length, 0);
  resolve({ id, state: 'queued' }); await waiting;
  assert.deepEqual(committed, [id]);
  await assert.rejects(acceptUpload(id, async () => { throw Error('Choose a video under 100 MB.'); }, () => committed.push('bad')), /under 100 MB/);
  await assert.rejects(acceptUpload(id, async () => ({ id: 'b'.repeat(64), state: 'queued' }), () => committed.push('bad')), /not confirmed/);
  assert.deepEqual(committed, [id]);
});
test('lost acknowledgement recovers the persisted key without sending another upload', async () => {
  let sends = 0, reads = 0; const route = { pending: id };
  const result = await acceptUpload(id, () => sendOrRecover(async () => { sends++; throw Error('connection lost'); }, async () => { reads++; return { id: uploadRoute(route).pendingId!, state: 'complete' }; }), () => {});
  assert.equal(result.id, id); assert.equal(sends, 1); assert.equal(reads, 1);
  await assert.rejects(sendOrRecover(async () => { throw Error('not a video'); }, async () => { throw Error('404'); }), /not a video/);
});
test('new selection invalidates pending recovery and delayed errors', () => {
  const generation = new UploadGeneration(); const recoveringA = generation.next();
  const selectingB = generation.next();
  assert.equal(generation.isCurrent(recoveringA), false);
  assert.equal(generation.isCurrent(selectingB), true);
});
test('empty prepared is a fresh accepted job; pending upload is not polled as an accepted job', () => {
  assert.deepEqual(uploadRoute({ job: id, prepared: '' }), { id, pendingId: undefined, prepared: false });
  assert.deepEqual(uploadRoute({ pending: id, prepared: '' }), { id: undefined, pendingId: id, prepared: false });
  assert.equal(uploadRoute({ job: id, prepared: '1' }).prepared, true);
});
