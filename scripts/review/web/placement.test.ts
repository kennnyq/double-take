/**
 * The reviewer must put every box where the app's double take does. This checks
 * (1) the app still uses the rules placement.ts copies its wiring from, and
 * (2) real tells, on portrait and landscape clips, land on the same video pixels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { boxOnStage, fitFor, videoRect } from '../../../src/feed/tells.ts';
import { readTellsFile } from '../../../src/annotations/format.ts';
import { appFit, areaFor, coverScale, frameFor, insetPoint, stageInset } from './placement.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('the app still wires the double take the way placement.ts assumes', () => {
  const clip = src('src/feed/ClipItem.tsx');
  assert.match(clip, /const baseFit = fitFor\(clip\.aspect\);/, 'ClipItem: base fit from fitFor');
  assert.match(clip, /const fit = inspecting \? 'contain' : baseFit;/, 'ClipItem: contain during the double take');
  assert.match(clip, /Math\.max\(clip\.aspect! \/ \(stageW \/ stageH\), stageW \/ stageH \/ clip\.aspect!\)/, 'ClipItem: coverScale');
  assert.match(clip, /inspectInset\(stageW, stageH,/, 'ClipItem: the inset comes from inspectInset');
  assert.match(clip, /stageW=\{stageW\}[\s\S]{0,80}stageH=\{stageH\}[\s\S]{0,80}aspect=\{clip\.aspect \?\? 9 \/ 16\}[\s\S]{0,40}fit=\{fit\}/, 'ClipItem: what TellOverlay gets');
  const overlay = src('src/feed/TellOverlay.tsx');
  assert.match(overlay, /const frame = videoRect\(p\.stageW, p\.stageH, p\.aspect, p\.fit\);/, 'TellOverlay: frame');
  assert.match(overlay, /boxOnStage\(t\.box, frame, p\.stageW, p\.stageH\)/, 'TellOverlay: box to stage');
});

// Real clips: the feed's width × height, and their tells from the repo.
const CLIPS = [
  { key: 'x-2106432142217765020', w: 722, h: 1280 }, // portrait, boxes on the left edge
  { key: 'x-2007412078227697722', w: 770, h: 1280 }, // portrait, a box on the top edge
  { key: 'x-2028129476023029902', w: 722, h: 1280 }, // portrait, boxes on the right edge
  { key: 'x-2023151052800000040', w: 1280, h: 720 }, // landscape, letterboxed
];
// The reviewer's stage (9:16, like the app's desktop card) and a phone screen.
const STAGES = [
  { W: 436, H: 776 },
  { W: 430, H: 932 },
];

for (const c of CLIPS) {
  test(`${c.key} (${c.w}×${c.h}): boxes land where the app's overlay puts them`, () => {
    const tells = readTellsFile(JSON.parse(src(`scripts/harvest/tells/${c.key}.json`))).tells.filter((t) => t.box);
    assert.ok(tells.length, 'has boxed tells');
    const aspect = c.w / c.h;
    for (const { W, H } of STAGES) {
      for (const t of tells) {
        for (const mode of ['play', 'doubleTake'] as const) {
          // What the app's TellOverlay computes, written out from ClipItem's wiring.
          const appFitNow = mode === 'doubleTake' ? 'contain' : fitFor(aspect);
          const app = boxOnStage(t.box!, videoRect(W, H, aspect, appFitNow), W, H);
          assert.deepEqual(areaFor(t.box!, W, H, aspect, mode), app, `${t.id} ${mode} ${W}×${H}`);
        }
        // In the double take the whole frame shows, so no box is ever cropped.
        const dt = areaFor(t.box!, W, H, aspect, 'doubleTake')!;
        const f = frameFor(W, H, aspect, 'doubleTake');
        assert.ok(dt.x >= f.x - 1e-6 && dt.y >= f.y - 1e-6 && dt.x + dt.w <= f.x + f.w + 1e-6 && dt.y + dt.h <= f.y + f.h + 1e-6, `${t.id} inside the frame`);
        assert.ok(Math.abs(dt.w - t.box!.w * f.w) < 1e-6 && Math.abs(dt.h - t.box!.h * f.h) < 1e-6, `${t.id} not cropped`);
      }
    }
  });
}

test('the cover zoom is the contained frame scaled about the stage centre, so a box drawn on the contained video stays on its pixels', () => {
  for (const { W, H } of STAGES) {
    for (const c of CLIPS) {
      const a = c.w / c.h;
      const k = coverScale(W, H, a, 'play');
      const contain = frameFor(W, H, a, 'doubleTake');
      const play = videoRect(W, H, a, appFit(a, 'play'));
      const scaled = { x: W / 2 + (contain.x - W / 2) * k, y: H / 2 + (contain.y - H / 2) * k, w: contain.w * k, h: contain.h * k };
      for (const p of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(scaled[p] - play[p]) < 1e-6, `${c.key} ${p}`);
      if (fitFor(a) === 'contain') assert.equal(k, 1);
    }
  }
});

test('the inset maps the stage centre to itself, shifted by dy, and scales everything else about it', () => {
  const inset = stageInset(436, 776, 28);
  assert.ok(inset.scale > 0.9 && inset.scale < 1);
  const c = insetPoint(218, 388, 436, 776, inset);
  assert.ok(Math.abs(c.x - 218) < 1e-9 && Math.abs(c.y - (388 + inset.dy)) < 1e-9);
  const corner = insetPoint(0, 0, 436, 776, inset);
  assert.ok(Math.abs(corner.x - 218 * (1 - inset.scale)) < 1e-9);
});
