import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const port = Number(process.env.JOBS_TEST_PORT ?? 8799);
const files = ['server.ts','analyzer.ts','worker.ts','types.ts','media.ts','links.ts','upload-log.ts'];
test('isolated copied runner: disabled recovery, custom analyzer, timeout, binding, private trace, restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upload-jobs-portable-'));
  const saved = { ...process.env };
  let server: import('node:http').Server | undefined;
  try {
    const code = join(root, 'runner'); await mkdir(code);
    for (const file of files) await copyFile(join(import.meta.dirname,file), join(code,file));
    const { startServer } = await import(pathToFileURL(join(code,'server.ts')).href);
    const video = join(root, 'fixture.mp4');
    execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=s=160x90:r=10:d=0.2','-c:v','libx264','-threads','1',video]);
    const bytes = await readFile(video);
    const data = join(root, 'data');
    const analyzer = join(root, 'analyzer.mjs');
    const result = `{version:1,clipId:input.clipId,mediaSha256:input.mediaSha256,mode:'fresh',components:[],evidence:[],limitations:[],elapsedMs:1,inspection:{version:1,components:[],signals:[],moments:[],trace:['nested-secret']},trace:['private-secret']}`;
    delete process.env.JOBS_ANALYZER_MODULE; delete process.env.JOBS_ANALYZER_DISABLED;
    process.env.JOBS_ORIGIN = 'https://app.example.com';
    server = await startServer(data,port);
    const base = `http://localhost:${port}`;
    const id = () => randomBytes(32).toString('hex');
    async function settled(key: string) {
      for (let i=0;i<200;i++) {
        const r = await (await fetch(`${base}/jobs/${key}`)).json();
        if (!['queued','running'].includes(r.state)) return r;
        await new Promise(r => setTimeout(r,20));
      }
      throw Error('Job did not settle');
    }
    async function upload(key: string) { assert.equal((await fetch(`${base}/jobs/${key}`, {method:'PUT',body:bytes})).status,202); return settled(key); }
    assert.deepEqual(await (await fetch(base+'/prepared')).json(),[]);
    const key = id();
    const unavailable = await upload(key);
    assert.equal(unavailable.errorCode,'analysis_unavailable'); assert.equal(unavailable.retryable,true);
    assert.equal((await fetch(`${base}/jobs/${key}/media`)).status,200);
    assert.equal((await fetch(`${base}/jobs/${key}`, {method:'PUT',body:bytes})).status,200);
    await writeFile(analyzer, `import {readFile,appendFile} from 'node:fs/promises'; import {createHash} from 'node:crypto'; export async function analyze(input,context) { if (createHash('sha256').update(await readFile(input.mediaPath)).digest('hex')!==input.mediaSha256 || !(context.signal instanceof AbortSignal) || context.deadline<=Date.now()) throw Error('bad input'); await appendFile(context.outputDir+'/calls','1'); return ${result}; }`);
    process.env.JOBS_ANALYZER_MODULE = analyzer;
    process.env.JOBS_ANALYZER_TIMEOUT_MS = '2000';
    const retries = await Promise.all([fetch(`${base}/jobs/${key}/retry`, {method:'POST'}),fetch(`${base}/jobs/${key}/retry`, {method:'POST'})]);
    assert.deepEqual(retries.map(r=>r.status).sort(),[200,202]);
    const success = await settled(key);
    assert.equal(success.state,'complete'); assert.equal(success.result.mediaSha256,success.sha256);
    assert.equal(success.result.inspection.version,1); assert.equal(success.result.trace,undefined);
    assert.equal(JSON.stringify(success).includes('secret'),false);
    assert.equal(await readFile(join(data,key,'analysis/calls'),'utf8'),'1');
    const origin = await fetch(`${base}/jobs/${key}`, {headers:{Origin:'https://app.example.com'}});
    assert.equal(origin.headers.get('access-control-allow-origin'),'https://app.example.com');
    assert.equal((await fetch(`${base}/jobs/${key}`, {headers:{Origin:'https://elsewhere.example'}})).headers.get('access-control-allow-origin'),null);
    for (const [name, source, expected] of [
      ['binding', `export async function analyze(input) { return {...${result},mediaSha256:'wrong'}; }`, 'result_binding_failed'],
      ['timeout', `export async function analyze() { setInterval(()=>{},1000); await new Promise(()=>{}); }`, 'analysis_timeout'],
      ['throws', `export async function analyze() { throw Error('private-secret'); }`, 'analysis_failed'],
    ]) {
      const module = join(root,name+'.mjs'); await writeFile(module,source);
      process.env.JOBS_ANALYZER_MODULE = module; process.env.JOBS_ANALYZER_TIMEOUT_MS = '300';
      const failed = await upload(id());
      assert.equal(failed.state,'error'); assert.equal(failed.errorCode,expected); assert.equal(failed.result,undefined);
      assert.equal(JSON.stringify(failed).includes('private-secret'),false);
    }
    await new Promise<void>(r=>server!.close(()=>r()));
    server = await startServer(data,port);
    const restored = await settled(key); assert.equal(restored.state,'complete'); assert.equal(restored.result.trace,undefined);
    assert.equal(await readFile(join(data,key,'analysis/calls'),'utf8'),'1');
  } finally {
    if (server?.listening) await new Promise<void>(r=>server!.close(()=>r()));
    for (const key of ['JOBS_ANALYZER_MODULE','JOBS_ANALYZER_DISABLED','JOBS_ANALYZER_TIMEOUT_MS','JOBS_ORIGIN']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(root,{recursive:true,force:true});
  }
});
