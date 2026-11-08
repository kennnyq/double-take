import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBoundResult, publicResult, type AnalysisResult } from './types.ts';
import { runAnalyzer } from './analyzer.ts';
import { retrieveVideo } from './links.ts';
import { probe, preparePlayback, UploadError } from './media.ts';
import { recordUpload, readRejection, publicRejection, type UploadEvent } from './upload-log.ts';
export { probe } from './media.ts';
export const MAX_BYTES = 100 * 1024 * 1024;
const TTL = 24 * 3600 * 1000;
export interface Job {
  id: string; state: 'queued' | 'running' | 'complete' | 'error'; createdAt: number;
  sha256: string; duration: number; width: number; height: number; hasAudio: boolean;
  result?: AnalysisResult; error?: string; errorCode?: string; retryable?: boolean;
  linkSha256?: string; playbackFile?: 'playback.mp4';
}
function boundResult(result: AnalysisResult | undefined, job: Job): result is AnalysisResult {
  return isBoundResult(result, job.id, job.sha256);
}
function publicJob(job: Job) {
  const { result, ...rest } = job;
  return { ...rest, ...(job.state === 'complete' && boundResult(result, job) ? { result: publicResult(result) } : {}) };
}
export async function startServer(root: string, port: number, run: (dir: string, job: Job) => Promise<AnalysisResult> = runAnalyzer) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const jobs = new Map<string, Job>();
  const uploads = new Set<string>();
  let busy = false;
  const save = async (j: Job) => { const p = join(root, j.id, 'job.json'); await writeFile(p + '.tmp', JSON.stringify(j), { mode: 0o600 }); await rename(p + '.tmp', p); };
  for (const id of await readdir(root)) {
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    try {
      const j: Job = JSON.parse(await readFile(join(root, id, 'job.json'), 'utf8'));
      if (j.id !== id || !Number.isFinite(j.createdAt) || !['queued','running','complete','error'].includes(j.state)) throw new Error('Invalid saved job');
      if (Date.now() - j.createdAt > TTL) { await rm(join(root, id), { recursive: true, force: true }); continue; }
      if (j.state === 'running') { j.state = 'error'; j.error = 'Analysis interrupted. Your upload is saved.'; j.errorCode = 'analysis_interrupted'; j.retryable = true; await save(j); }
      if (j.state !== 'complete' || !boundResult(j.result, j)) {
        delete j.result;
        if (j.state === 'complete') { j.state = 'error'; j.error = 'Saved analysis did not match this upload.'; j.errorCode = 'result_binding_failed'; j.retryable = true; }
        await save(j);
      }
      jobs.set(id, j);
    } catch { await rm(join(root, id), { recursive: true, force: true }); }
  }
  async function drain() {
    if (busy) return;
    const j = [...jobs.values()].find(j => j.state === 'queued');
    if (!j) return;
    busy = true;
    try {
      j.state = 'running'; await save(j);
      const result = await run(join(root, j.id), j);
      if (!boundResult(result, j)) throw new Error('Result did not match the uploaded video.');
      j.result = result;
      j.state = 'complete'; delete j.error; delete j.errorCode; delete j.retryable;
    } catch (error) {
      delete j.result; j.state = 'error';
      j.errorCode = analysisErrorCode(error);
      j.retryable = true;
      j.error = 'Analysis unavailable. Your upload is saved; you can retry analysis later.';
      await appendFile(join(root,'analysis-events.jsonl'),JSON.stringify({at:new Date().toISOString(),id:j.id,event:'failed',code:j.errorCode})+'\n',{mode:0o600});
    }
    finally { await save(j); busy = false; void drain(); }
  }
  const server = createServer(async (req, res) => {
    const origins = (process.env.JOBS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (req.headers.origin && origins.includes(req.headers.origin)) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/health') { send(200, { ok: true }); return; }
    if (req.method === 'GET' && req.url === '/prepared') { send(200, []); return; }
    const match = /^\/jobs\/([a-f0-9]{64})(\/media|\/retry)?$/.exec(req.url ?? '');
    if (!match) { send(404, { error: 'Not found' }); return; }
    const [, id, media] = match;
    const dir = join(root, id);
    try {
      const old = jobs.get(id);
      if (media === '/retry') {
        req.resume();
        if (req.method !== 'POST' || !old) { send(404, { error: 'Not found' }); return; }
        if (old.state !== 'error') { send(200, publicJob(old)); return; }
        if (uploads.has(id) || [...jobs.values()].filter(j => j.state === 'queued').length + uploads.size >= 8) { send(429, { error: 'Busy. Retry analysis shortly.' }); return; }
        old.state = 'queued'; delete old.result; delete old.error; delete old.errorCode; delete old.retryable;
        await save(old); send(202, publicJob(old)); void drain(); return;
      }
      if (req.method === 'GET' && old) {
        if (media) await streamMedia(req, res, join(dir, old.playbackFile === 'playback.mp4' ? 'playback.mp4' : 'original'));
        else send(200, publicJob(old));
        return;
      }
      if (req.method === 'GET' && !old && !media) { send(404, await readRejection(root, id) ?? { error: 'Not found' }); return; }
      if (req.method === 'DELETE' && old) {
        if (uploads.has(id)) { send(409, { error: 'Wait for the upload to finish.' }); return; }
        if (old.state === 'running') { send(409, { error: 'Wait for analysis to finish before deleting.' }); return; }
        jobs.delete(id); await rm(dir, { recursive: true, force: true }); send(200, { deleted: true }); return;
      }
      if (!['PUT', 'POST'].includes(req.method ?? '') || media) { send(404, { error: 'Not found' }); return; }
      if (uploads.has(id) || uploads.size >= 2 || (!old && ([...jobs.values()].filter(j => j.state === 'queued').length + uploads.size >= 8 || jobs.size + uploads.size >= 40))) { req.resume(); send(429, { error: 'Busy. Retry this upload shortly.' }); return; }
      if (Number(req.headers['content-length']) > MAX_BYTES) {
        const event: UploadEvent = { id, at: new Date().toISOString(), event: 'rejected', stage: 'headers', code: 'size_exceeded', error: 'Choose a video under 100 MB.', bytes: Number(req.headers['content-length']) };
        await recordUpload(root, event); req.resume(); send(413, publicRejection(event)); return;
      }
      uploads.add(id);
      let stage = 'receiving', size = 0, sha256: string | undefined;
      const contentType = String(req.headers['content-type'] ?? '').slice(0, 128);
      try {
        await recordUpload(root, { id, at: new Date().toISOString(), event: 'received', stage, contentType });
        if (!old) await mkdir(dir, { mode: 0o700 });
        const hash = createHash('sha256');
        const limiter = new Transform({ transform(chunk, _enc, cb) { size += chunk.length; hash.update(chunk); cb(size > MAX_BYTES ? new UploadError('size_exceeded', 'Choose a video under 100 MB.') : null, chunk); } });
        const timeout = AbortSignal.timeout(60000);
        let source: IncomingMessage = req;
        let linkSha256: string | undefined;
        if (req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Choose a shorter video link.'); }
          const input = JSON.parse(body);
          if (Object.keys(input).some(k => k !== 'url')) throw new Error('Choose a video up to 60 seconds. Trimming is not available yet.');
          if (typeof input.url !== 'string') throw new Error('Choose a video link.');
          linkSha256 = createHash('sha256').update(input.url.trim()).digest('hex');
          if (old) {
            if (old.linkSha256 === linkSha256) send(200, publicJob(old));
            else send(409, { error: 'This upload belongs to a different video. Choose it as a new check.', code: 'upload_mismatch' });
            return;
          }
          source = await retrieveVideo(input.url, MAX_BYTES, timeout);
        }
        if (old) {
          // A retry key is not proof that this request contains the same file.
          await pipeline(source, limiter, new Writable({ write(_chunk, _encoding, done) { done(); } }), { signal: timeout });
          if (hash.digest('hex') === old.sha256) send(200, publicJob(old));
          else send(409, { error: 'This upload belongs to a different video. Choose it as a new check.', code: 'upload_mismatch' });
          return;
        }
        await pipeline(source, limiter, createWriteStream(join(dir, 'original.part'), { mode: 0o600 }), { signal: timeout });
        await rename(join(dir, 'original.part'), join(dir, 'original'));
        sha256 = hash.digest('hex'); stage = 'validating';
        const info = await probe(join(dir, 'original'));
        stage = 'playback';
        const playbackFile = await preparePlayback(join(dir, 'original'), info);
        const j: Job = { id, state: 'queued', createdAt: Date.now(), sha256, ...(linkSha256 ? { linkSha256 } : {}), duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, ...(playbackFile ? { playbackFile } : {}) };
        stage = 'saving'; await save(j);
        await recordUpload(root, { id, at: new Date().toISOString(), event: 'accepted', stage, bytes: size, sha256, contentType, details: { ...info, playbackFile } });
        jobs.set(id, j); send(202, j); void drain();
      } catch (error) {
        const event: UploadEvent = { id, at: new Date().toISOString(), event: 'rejected', stage, bytes: size, sha256, contentType,
          code: error instanceof UploadError ? error.code : 'upload_failed',
          error: error instanceof UploadError || (error instanceof Error && error.message.startsWith('Choose')) ? error.message : 'The upload could not be completed. Select the video again to retry.',
          details: error instanceof UploadError ? error.details : { errorType: error instanceof Error ? error.name : 'unknown' } };
        await recordUpload(root, event);
        if (!old) await rm(dir, { recursive: true, force: true });
        if (!res.destroyed) send(event.code === 'size_exceeded' ? 413 : 400, publicRejection(event));
      }
      finally { uploads.delete(id); }
    } catch { if (!res.headersSent) send(500, { error: 'Could not complete request.' }); else res.destroy(); }
  });
  server.requestTimeout = 300000;
  const cleanup = setInterval(() => { for (const j of jobs.values()) if (j.state !== 'running' && Date.now() - j.createdAt > TTL) { jobs.delete(j.id); void rm(join(root, j.id), { recursive: true, force: true }); } }, 60000);
  cleanup.unref(); server.on('close', () => clearInterval(cleanup));
  await new Promise<void>((done, reject) => {
    const failed = (error: Error) => { clearInterval(cleanup); reject(error); };
    server.once('error', failed);
    server.listen(port, '0.0.0.0', () => { server.off('error', failed); done(); });
  }); void drain(); return server;
}
export async function streamMedia(req: IncomingMessage, res: ServerResponse, path: string) {
  const { size } = await stat(path);
  let start = 0, end = size - 1;
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end;
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
  }
  res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  await pipeline(createReadStream(path, { start, end }), res);
}
export function analysisErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message === 'Analysis unconfigured' ? 'analysis_unavailable'
    : message === 'Analysis configuration invalid' ? 'analysis_configuration'
    : message === 'Analysis timeout' ? 'analysis_timeout'
    : message === 'Result did not match the uploaded video.' ? 'result_binding_failed' : 'analysis_failed';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.JOBS_DIR) throw new Error('Set JOBS_DIR to a private persistent data directory');
  await startServer(resolve(process.env.JOBS_DIR), Number(process.env.PORT ?? 8790));
  console.log('Private job runner listening');
}
