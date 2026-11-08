import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probe, preparePlayback } from './media.ts';
import { startServer, type Job } from './server.ts';
import type { AnalysisResult as InvestigationResult } from './types.ts';

const root = await mkdtemp(join(tmpdir(), 'upload-jobs-media-'));
after(() => rm(root, { recursive: true, force: true }));
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v','error','-nostdin','-y',...args], { stdio: 'pipe' });
function fixture(j: Job): InvestigationResult {
  return { version: 1, clipId: j.id, mediaSha256: j.sha256, mode: 'fixture', components: [], evidence: [], limitations: ['Transport only.'], trace: [], elapsedMs: 0 };
}
test('video duration governs the envelope; durable rejection survives restart and allows corrected retry', async () => {
  const padded = join(root,'padding.mp4'), long = join(root,'long.mp4');
  ffmpeg(['-f','lavfi','-i','color=s=160x90:r=30:d=60','-f','lavfi','-i','sine=duration=60.1','-c:v','libx264','-threads','1','-c:a','aac',padded]);
  ffmpeg(['-f','lavfi','-i','color=s=160x90:r=10:d=61','-c:v','libx264','-threads','1',long]);
  const jobRoot = join(root,'jobs'); await rm(jobRoot,{recursive:true,force:true});
  const port = Number(process.env.JOBS_TEST_PORT ?? 8799), id=randomBytes(32).toString('hex'), url=`http://localhost:${port}/jobs/${id}`;
  let calls=0;
  const run=async (_:string,j:Job) => { calls++; assert.equal((await probe(join(jobRoot,j.id,'original'))).containerDuration! > 60,true); return fixture(j); };
  let server=await startServer(jobRoot,port,run);
  try {
    let r=await fetch(url,{method:'PUT',body:await readFile(long)}); assert.equal(r.status,400);
    const rejected=await r.json(); assert.equal(rejected.code,'duration_exceeded'); assert.equal(rejected.duration,61); assert.equal(rejected.requestId,id); assert.equal(calls,0);
    assert.equal(existsSync(join(jobRoot,id)),false);
    await new Promise<void>(r=>server.close(()=>r())); server=await startServer(jobRoot,port,run);
    r=await fetch(url); assert.equal(r.status,404); assert.deepEqual(await r.json(),rejected);
    const bytes=await readFile(padded);
    r=await fetch(url,{method:'PUT',body:bytes}); assert.equal(r.status,202);
    let job:Job=await r.json();
    for(let n=0;n<200 && ['queued','running'].includes(job.state);n++) { await new Promise(r=>setTimeout(r,20)); job=await(await fetch(url)).json(); }
    assert.equal(job.state,'complete'); assert.equal(job.duration,60); assert.equal(job.playbackFile,'playback.mp4'); assert.equal(calls,1);
    assert.equal(job.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await readFile(join(jobRoot,id,'original')),bytes);
    const playback=await probe(join(jobRoot,id,'playback.mp4')); assert.ok(playback.containerDuration!<=60.001); assert.equal(playback.audioProfile,'LC');
    const range=await fetch(url+'/media',{headers:{Range:'bytes=0-15'}}); assert.equal(range.status,206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()),(await readFile(join(jobRoot,id,'playback.mp4'))).subarray(0,16));
    const events=(await readFile(join(jobRoot,'upload-events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(events.filter(e=>e.event==='rejected').length,1); assert.equal(events.at(-1).details.duration,60); assert.ok(events.at(-1).details.containerDuration>60);
    await new Promise<void>(r=>server.close(()=>r())); server=await startServer(jobRoot,port,run);
    assert.equal((await(await fetch(url)).json()).state,'complete'); assert.equal(calls,1);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
test('HEVC, ProRes and variable-frame recordings decode and receive browser playback', async () => {
  for(const [name,codec,extra] of [
    ['hevc','libx265',['-pix_fmt','yuv420p','-x265-params','log-level=error:pools=1']],
    ['prores','prores_ks',['-pix_fmt','yuv422p10le']],
    ['variable','libx265',['-pix_fmt','yuv420p','-x265-params','log-level=error:pools=1','-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr']],
  ] as const) {
    const dir=join(root,name);await mkdir(dir,{recursive:true});const path=join(dir,'original.mov');
    ffmpeg(['-f','lavfi','-i','testsrc2=s=160x90:r=30:d=1','-c:v',codec,'-threads','1',...extra,path]);
    const info=await probe(path); assert.equal(await preparePlayback(path,info),'playback.mp4');
    const output=await probe(join(dir,'playback.mp4'));assert.equal(output.videoCodec,'h264');assert.equal(output.pixelFormat,'yuv420p');assert.equal(output.width,160);assert.equal(output.height,90);assert.ok(Math.abs(output.duration-info.duration)<.1);
  }
});
