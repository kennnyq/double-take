/** Operator code executes in a bounded subprocess, never inside the HTTP server. */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isBoundResult, type Analyzer } from './types.ts';
try {
  const [modulePath, inputPath, outputPath] = process.argv.slice(2);
  if (!isAbsolute(modulePath)) throw Error('Invalid module');
  const { input, outputDir, deadline } = JSON.parse(await readFile(inputPath, 'utf8'));
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.analyze !== 'function') throw Error('Missing analyze export');
  const analyze: Analyzer = module.analyze;
  const result = await analyze(input, { outputDir, deadline, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  if (!isBoundResult(result, input.clipId, input.mediaSha256)) process.exit(2);
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw Error('Output too large');
  await writeFile(outputPath, json, { mode: 0o600 });
} catch { process.exitCode = 1; }
