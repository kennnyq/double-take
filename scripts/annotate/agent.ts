/**
 * A second annotation engine: the same two prompts the Nemotron pipeline sends
 * (claims, then boxes), answered by a coding agent (e.g. a Claude subagent)
 * that reads the request from disk and writes its JSON reply back.
 *
 * It plugs into `annotateClip` as a client, so its replies go through exactly
 * the same validation, quote checks, pixel check and publishing as NVIDIA's,
 * which keeps the comparison fair. Each `run` call goes as far as it has
 * replies for, writes the next request and stops with `AwaitingReply`:
 *
 *   run → claims.request.md   (agent writes claims.reply.json)
 *   run → draft.request.md    (agent views the gridded frames, writes draft.reply.json)
 *   run → draft.json, report.md, review.jpg  (then publish)
 *
 * No network calls and no keys.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ChatRequest, NimClient } from './nim.ts';

export class AwaitingReply extends Error {
  readonly step: string;
  readonly request: string;
  readonly reply: string;
  constructor(step: string, request: string, reply: string) {
    super(`waiting for the ${step} reply: read ${request}, write ${reply}, then run again`);
    this.name = 'AwaitingReply';
    this.step = step;
    this.request = request;
    this.reply = reply;
  }
}

const STEPS = ['claims', 'draft'] as const;

/** Answers chat requests from `<dir>/<step>.reply.json`, asking for each one it lacks. */
export function agentClient(dir: string, model: string): NimClient {
  let i = 0;
  const log: NimClient['log'] = [];
  return {
    log,
    models: async () => [model],
    chat: async (req: ChatRequest) => {
      const step = STEPS[i++] ?? `step${i}`;
      const reply = join(dir, `${step}.reply.json`);
      const request = join(dir, `${step}.request.md`);
      writeFileSync(request, requestMarkdown(step, req, reply));
      if (!existsSync(reply)) throw new AwaitingReply(step, request, reply);
      const text = readFileSync(reply, 'utf8');
      log.push({ model, status: 200, ms: 0, attempt: 1 });
      // Same shape as the hosted API, so completionText() reads it unchanged.
      return { model, choices: [{ message: { role: 'assistant', content: text } }] };
    },
  };
}

function requestMarkdown(step: string, req: ChatRequest, reply: string): string {
  const L: string[] = [`# ${step} request`, ''];
  L.push(
    `Answer with ONE JSON object matching the schema at the end, and write only that JSON to:`,
    '',
    `    ${reply}`,
    '',
    'Base every claim on the source texts and every box on what you can actually see in the frames. Leave out anything you cannot see; an honest "visible": "no" is better than a guessed box.',
    '',
  );
  for (const m of req.messages) {
    L.push(`## ${m.role}`, '');
    if (typeof m.content === 'string') L.push(m.content, '');
    else
      for (const c of m.content) {
        if (c.type === 'text') L.push(c.text, '');
        else L.push(`![frame](${c.image_url.url.replace(/^file:\/\//, '')})`, '');
      }
  }
  if (step === 'draft') {
    L.push(
      '## How to read the frames',
      '',
      'Each frame image has a grid every 100 units with labels in 0-1000 coordinates (x across the top, y down the left side), the same space bbox_2d uses. Open each image with your file-reading tool. Consecutive frames are close together around claimed moments: compare neighbours to find the first frame where something changes.',
      '',
    );
  }
  if (req.guided_json) L.push('## JSON schema', '', '```json', JSON.stringify(req.guided_json, null, 1), '```', '');
  return `${L.join('\n')}\n`;
}

/**
 * A copy of a frame with a 10×10 grid and 0-1000 labels, for an agent to read
 * box coordinates off. The original frame (no grid) is what the pixel check
 * and the review sheet use.
 */
export function griddedFrame(file: string, w: number, h: number): string {
  const out = join(dirname(file), 'grid', basename(file));
  if (existsSync(out)) return out;
  mkdirSync(dirname(out), { recursive: true });
  const label = (text: string, x: number, y: number) =>
    `drawtext=text='${text}':x=${x}:y=${y}:fontsize=13:fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=2`;
  const labels: string[] = [];
  for (let k = 1; k < 10; k++) {
    labels.push(label(`${k * 100}`, Math.round((w * k) / 10) + 2, 2));
    labels.push(label(`${k * 100}`, 2, Math.round((h * k) / 10) + 2));
  }
  const vf = [`drawgrid=w=iw/10:h=ih/10:t=1:c=white@0.45`, ...labels].join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', vf, '-q:v', '3', out]);
  return out;
}
