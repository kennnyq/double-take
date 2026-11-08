import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer, MAX_BYTES, type Job } from './server.ts';
import type { AnalysisResult as InvestigationResult } from './types.ts';
const testPort = Number(process.env.JOBS_TEST_PORT ?? 8799);
const root = await mkdtemp(join(tmpdir(), 'upload-jobs-server-'));
after(() => rm(root, { recursive: true, force: true }));
function fixture(j: Job): InvestigationResult {
  return { version: 1, clipId: j.id, mediaSha256: j.sha256, mode: 'fixture', components: ['visuals', 'subject', 'audio'].map(c => ({ component: c as 'visuals' | 'subject' | 'audio', assessment: c === 'audio' && !j.hasAudio ? 'not_applicable' : 'unknown', summary: 'Transport fixture; no authenticity inference.', evidenceIds: [] })), evidence: [], limitations: ['Transport fixture only.'], trace: [], elapsedMs: 0 };
}
test('upload/job lifecycle and 12 scenario transport matrix', async () => {
  const jobRoot = join(root, 'jobs'); await rm(jobRoot, { recursive: true, force: true });
  let calls = 0;
  const server = await startServer(jobRoot, testPort, async (_dir, j) => { calls++; if (j.duration > 3 && j.duration < 4) throw new Error('detector timeout'); return fixture(j); });
  const base = `http://localhost:${testPort}/jobs/`;
  try {
    for (const [name, size, duration, audio] of [
      ['portrait', '90x160', 1, false], ['landscape', '160x90', 1, false], ['short', '160x90', 0.2, false],
      ['long-supported', '160x90', 60, false], ['silent', '160x90', 1, false],
      ['audio-transport-not-voice-gold', '160x90', 1, true], ['subject-transport-not-insertion-gold', '160x90', 1, false],
      ['no-useful-signal', '160x90', 1, false], ['detector-timeout', '160x90', 3.5, false],
    ] as const) {
      const path = join(root, `${name}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${size}:r=10`, ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000'] : []), '-t', String(duration), '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', path]);
      const bytes = await readFile(path); const id = randomBytes(32).toString('hex');
      const response = await fetch(base + id, { method: 'PUT', body: bytes }); assert.equal(response.status, 202, name);
      let j: Job = await response.json();
      for (let n = 0; n < 100 && (j.state === 'queued' || j.state === 'running'); n++) { await new Promise(r => setTimeout(r, 20)); j = await (await fetch(base + id)).json(); }
      assert.equal(j.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(j.state, name === 'detector-timeout' ? 'error' : 'complete', name);
      assert.equal(j.hasAudio, audio);
      const before = calls; assert.equal((await fetch(base + id, { method: 'PUT', body: bytes })).status, 200); assert.equal(calls, before);
      const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
      const mismatch = await fetch(base + id, { method: 'PUT', body: changed });
      assert.equal(mismatch.status, 409); assert.equal((await mismatch.json()).code, 'upload_mismatch');
      assert.equal(calls, before);
      assert.deepEqual(await readFile(join(jobRoot, id, 'original')), bytes);
      const range = await fetch(base + id + '/media', { headers: { Range: 'bytes=0-15' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 16);
      assert.equal((await fetch(base + randomBytes(32).toString('hex'))).status, 404);
    }
    // Link failures never queue work; segment input cannot bypass duration limits.
    const beforeLinks = calls;
    for (const payload of [{ url: 'https://127.0.0.1/video.mp4' }, { url: 'https://youtube.com/watch?v=1' }, { url: 'https://example.com/v.mp4', start: 0, end: 60 }]) {
      const response = await fetch(base + randomBytes(32).toString('hex'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(response.status, 400); assert.match((await response.json()).error, /Choose/);
    }
    assert.equal(calls, beforeLinks);
    // Rotation metadata: remux rather than re-encode.
    const rotated = join(root, 'rotation.mov'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', join(root, 'landscape.mp4'), '-c', 'copy', rotated]);
    const rotatedJob = await (await fetch(base + randomBytes(32).toString('hex'), { method: 'PUT', body: await readFile(rotated) })).json(); assert.equal(rotatedJob.width, 90); assert.equal(rotatedJob.height, 160);
    assert.equal((await fetch(base + randomBytes(32).toString('hex'), { method: 'PUT', body: 'not video' })).status, 400);
    // Oversize body is rejected before decoding. Generate sparse buffer only for this structural test.
    const oversized = await fetch(base + randomBytes(32).toString('hex'), { method: 'PUT', body: Buffer.alloc(MAX_BYTES + 1) }); assert.equal(oversized.status, 413);
    await writeFile(join(root, 'report.json'), JSON.stringify({ scenarios: 12, hostedCalls: 0, transport: 'pass', devicePlayback: 'not tested', syntheticVoice: 'not evaluated', insertedSubject: 'not evaluated' }, null, 2));
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
test('restart retains completed results and never replays interrupted analysis', async () => {
  const jobRoot = join(root, 'restart'); await rm(jobRoot, { recursive: true, force: true });
  const id = randomBytes(32).toString('hex'); await mkdir(join(jobRoot, id), { recursive: true });
  await writeFile(join(jobRoot, id, 'job.json'), JSON.stringify({ id, state: 'running', createdAt: Date.now() }));
  let calls = 0; const server = await startServer(jobRoot, testPort, async (_dir, j) => { calls++; return fixture(j); });
  try { const j = await (await fetch(`http://localhost:${testPort}/jobs/${id}`)).json(); assert.equal(j.state, 'error'); assert.equal(calls, 0); }
  finally { await new Promise<void>(r => server.close(() => r())); }
});

test('wrong-video results never escape through GET, repeat PUT, or restart', async () => {
  for (const mismatch of ['clipId','mediaSha256','version'] as const) {
    const jobRoot=join(root,`mismatch-${mismatch}`);await rm(jobRoot,{recursive:true,force:true});
    const id=randomBytes(32).toString('hex');await mkdir(join(jobRoot,id),{recursive:true});
    const job:Job={id,state:'queued',createdAt:Date.now(),sha256:'expected-hash',duration:1,width:160,height:90,hasAudio:false};
    const bad={...fixture(job),[mismatch]:mismatch==='version'?2:'wrong'} as InvestigationResult;
    await writeFile(join(jobRoot,id,'job.json'),JSON.stringify(job));
    const server=await startServer(jobRoot,testPort,async()=>bad);
    const url=`http://localhost:${testPort}/jobs/${id}`;
    try {
      let response=await (await fetch(url)).json();
      for (let i=0;i<100 && response.state!=='error';i++) {await new Promise(r=>setTimeout(r,10));response=await(await fetch(url)).json();}
      assert.equal(response.state,'error');assert.equal(response.result,undefined);
      assert.equal((await (await fetch(url,{method:'PUT',body:'retry'})).json()).result,undefined);
      assert.equal(JSON.parse(await readFile(join(jobRoot,id,'job.json'),'utf8')).result,undefined);
    } finally {await new Promise<void>(r=>server.close(()=>r()));}
    // Old on-disk complete/error states containing rejected data are also quarantined.
    for(const state of ['complete','error'] as const) {
      await writeFile(join(jobRoot,id,'job.json'),JSON.stringify({...job,state,result:bad}));
      const restarted=await startServer(jobRoot,testPort,async()=>{throw Error('must not rerun');});
      try {const response=await(await fetch(url)).json();assert.equal(response.state,'error');assert.equal(response.result,undefined);}
      finally {await new Promise<void>(r=>restarted.close(()=>r()));}
    }
  }
});

test('stored-job limit rejects new uploads before analysis and does not replay completed work', async () => {
  const jobRoot=join(root,'capacity'); await mkdir(jobRoot,{recursive:true});
  for(let i=0;i<40;i++) {
    const id=i.toString(16).padStart(64,'0');
    const job:Job={id,state:'complete',createdAt:Date.now(),sha256:'a'.repeat(64),duration:1,width:160,height:90,hasAudio:false};
    job.result=fixture(job);
    await mkdir(join(jobRoot,id)); await writeFile(join(jobRoot,id,'job.json'),JSON.stringify(job));
  }
  let calls=0;
  const server=await startServer(jobRoot,testPort,async (_dir,j)=>{calls++;return fixture(j);});
  try {
    const response=await fetch(`http://localhost:${testPort}/jobs/${randomBytes(32).toString('hex')}`,{method:'PUT',body:'not admitted'});
    assert.equal(response.status,429);assert.equal(calls,0);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
