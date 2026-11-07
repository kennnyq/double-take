/**
 * ffmpeg helpers: probe a clip, detect letterbox bars, pick and extract the
 * frames a vision model sees, and draw boxes back onto full frames for a
 * human (or agent) spot check.
 */
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cropFromDetect } from '../../src/annotations/geometry.ts';
import type { Box, Tell } from '../../src/annotations/format.ts';
import type { SampledFrame } from '../../src/annotations/draft.ts';
import type { GrayFrame } from '../../src/annotations/pixelCheck.ts';

const run = promisify(execFile);

export interface Probe {
  width: number;
  height: number;
  duration: number;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ]);
  const d = JSON.parse(stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { width: d.streams[0].width, height: d.streams[0].height, duration: Number(d.format.duration) };
}

/**
 * Letterbox/pillarbox bars, as a frame-space crop. Uses the most frequent
 * `cropdetect` answer over the clip, so a dark moment doesn't count as bars.
 */
export async function detectCrop(file: string, p: Probe): Promise<Box | undefined> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'fps=2,cropdetect=limit=24:round=2:reset=1', '-f', 'null', '-'], {
    maxBuffer: 1 << 24,
  });
  const counts = new Map<string, number>();
  for (const m of stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best ? cropFromDetect(best[0], p.width, p.height) : undefined;
}

/**
 * Which moments to show the model: an even spread over the clip, plus a tight
 * bracket around each time a note names (artifacts are often a few frames
 * long, e.g. the dresser vanishes between 6.0 and 6.5 s).
 */
export function pickTimes(duration: number, claimTimes: number[], { spread = 8, max = 14, dense = false } = {}): number[] {
  const end = Math.max(0, duration - 0.05);
  const clamp = (t: number) => Math.round(Math.min(end, Math.max(0, t)) * 100) / 100;
  // Notes round times ("at 0:07" for a change at 6.2 s), so bracket generously.
  // Dense: a quarter-second "slow-motion" run, so a model sees motion between neighbouring frames.
  const offsets = dense ? [-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1] : [-1.5, -1, -0.5, 0, 0.5, 1];
  const near = claimTimes.flatMap((t) => offsets.map((d) => clamp(t + d)));
  const even = Array.from({ length: spread }, (_, i) => clamp(((i + 0.5) * duration) / spread));
  const out: number[] = [];
  // Claim brackets first, so the cap never drops them.
  for (const t of [...near, ...even]) {
    if (out.length >= max) break;
    if (out.every((o) => Math.abs(o - t) >= 0.2)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Scene-change scores (ffmpeg `scene`) at or above `min`, as [time, score] pairs. */
export async function sceneScores(file: string, min = 0.3): Promise<[number, number][]> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', `select='gt(scene,${min})',metadata=print:file=-`, '-an', '-f', 'null', '-'], {
    maxBuffer: 1 << 22,
  });
  const out: [number, number][] = [];
  let t: number | null = null;
  for (const line of String(stdout).split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = Number(pts[1]);
    const sc = /scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) out.push([t, Number(sc[1])]);
  }
  return out;
}

/** Extract frames (cropped to `crop`, long side `longSide` px) as JPEGs. */
export async function extractFrames(
  file: string,
  p: Probe,
  times: number[],
  outDir: string,
  { crop, longSide = 768 }: { crop?: Box; longSide?: number } = {},
): Promise<(SampledFrame & { file: string })[]> {
  mkdirSync(outDir, { recursive: true });
  const cw = crop ? Math.round(crop.w * p.width) : p.width;
  const ch = crop ? Math.round(crop.h * p.height) : p.height;
  const scale = longSide / Math.max(cw, ch);
  const w = Math.round((cw * scale) / 2) * 2;
  const h = Math.round((ch * scale) / 2) * 2;
  const filters = [
    ...(crop ? [`crop=${cw}:${ch}:${Math.round(crop.x * p.width)}:${Math.round(crop.y * p.height)}`] : []),
    `scale=${w}:${h}:flags=lanczos`,
  ].join(',');
  return Promise.all(
    times.map(async (t, index) => {
      const name = `f${String(index).padStart(2, '0')}.jpg`;
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', filters, '-q:v', '4', join(outDir, name)]);
      return { index, t, w, h, file: name };
    }),
  );
}

/** Decode sampled frame images to small greyscale buffers for the pixel check. */
export async function grayFrames(dir: string, frames: (SampledFrame & { file: string })[], width = 96): Promise<GrayFrame[]> {
  return Promise.all(
    frames.map(async (f) => {
      const h = Math.max(2, Math.round((width * f.h) / f.w));
      const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', join(dir, f.file), '-vf', `scale=${width}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
        encoding: 'buffer',
        maxBuffer: 1 << 22,
      });
      return { t: f.t, w: width, h, px: new Uint8Array(stdout) };
    }),
  );
}

/**
 * Review sheet: for each tell, the full (uncropped) frame at its focus time
 * with the box drawn exactly as the app would place it. This checks the whole
 * coordinate chain: model space → crop → frame fractions.
 */
export async function reviewSheet(file: string, p: Probe, tells: Tell[], outFile: string): Promise<boolean> {
  // One panel per boxed tell at its focus time, plus one at its "after" moment.
  const boxed = tells
    .filter((t) => t.box)
    .flatMap((t) => [
      { ...t, at: t.focusT ?? t.t0, tag: '' },
      ...(t.compareT !== undefined ? [{ ...t, at: t.compareT, tag: 'after ' }] : []),
    ]);
  if (!boxed.length) return false;
  const tmp = `${outFile}.parts`;
  mkdirSync(tmp, { recursive: true });
  const H = 640;
  const W = Math.round((p.width / p.height) * H / 2) * 2;
  const parts = await Promise.all(
    boxed.map(async (t, i) => {
      const b = t.box!;
      const x = Math.round(b.x * W);
      const y = Math.round(b.y * H);
      const bw = Math.max(2, Math.round(b.w * W));
      const bh = Math.max(2, Math.round(b.h * H));
      const out = join(tmp, `${i}.png`);
      const label = `${t.tag}${t.at}s ${t.label}`.replace(/[\\:'%,]/g, ' ').slice(0, 40);
      await run('ffmpeg', [
        '-v', 'error', '-y', '-ss', String(t.at), '-i', file, '-frames:v', '1',
        '-vf', `scale=${W}:${H},drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=yellow@0.95:t=4,` +
          `drawtext=text='${label}':x=8:y=8:fontsize=16:fontcolor=black:box=1:boxcolor=yellow@0.9:boxborderw=4`,
        out,
      ]);
      return out;
    }),
  );
  const inputs = parts.flatMap((f) => ['-i', f]);
  const layout = parts.length === 1 ? 'null' : `hstack=inputs=${parts.length}`;
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', layout, outFile]);
  return true;
}
