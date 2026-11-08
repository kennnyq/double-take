import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBoundResult, type AnalysisInput, type AnalysisResult } from './types.ts';
export const MAX_RESULT_BYTES = 2 * 1024 * 1024;
export async function runAnalyzer(dir: string, job: { id: string; sha256: string; duration: number; width: number; height: number; hasAudio: boolean }): Promise<AnalysisResult> {
  const module = process.env.JOBS_ANALYZER_MODULE;
  if (!module || process.env.JOBS_ANALYZER_DISABLED === '1') throw new Error('Analysis unconfigured');
  if (!isAbsolute(module)) throw new Error('Analysis configuration invalid');
  const timeout = Number(process.env.JOBS_ANALYZER_TIMEOUT_MS ?? 45000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 300000) throw new Error('Analysis configuration invalid');
  const input = join(dir, 'input.json'), output = join(dir, 'result.json');
  const data: AnalysisInput = { clipId: job.id, mediaSha256: job.sha256, mediaPath: join(dir, 'original'), duration: job.duration, width: job.width, height: job.height, hasAudio: job.hasAudio };
  await mkdir(join(dir, 'analysis'), { recursive: true, mode: 0o700 });
  await rm(output, { force: true }); // A failed retry cannot reuse an earlier worker's output.
  const deadline = Date.now() + timeout;
  await writeFile(input, JSON.stringify({ input: data, outputDir: join(dir, 'analysis'), deadline }), { mode: 0o600 });
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url)), module, input, output], { stdio: 'ignore', detached: process.platform !== 'win32' });
    const kill = () => { if (child.pid) try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } };
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Analysis unavailable')); });
    child.once('close', code => {
      clearTimeout(timer); kill(); // Also reap any descendants left behind by the operator module.
      if (timedOut) reject(new Error('Analysis timeout'));
      else if (code === 0) done();
      else reject(new Error(code === 2 ? 'Result did not match the uploaded video.' : 'Analysis unavailable'));
    });
  });
  if ((await stat(output)).size > MAX_RESULT_BYTES) throw new Error('Analysis output too large');
  const result = JSON.parse(await readFile(output, 'utf8'));
  if (!isBoundResult(result, job.id, job.sha256)) throw new Error('Result did not match the uploaded video.');
  return result;
}
