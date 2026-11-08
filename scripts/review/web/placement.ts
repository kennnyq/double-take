/**
 * Where an annotation lands on the reviewer's stage: the app's own rules, so a box
 * sits on exactly the video pixels it does in the app. Pure, so it runs under
 * `node --test` and in the browser (served type-stripped, see appModules.ts).
 *
 * The app (src/feed/ClipItem.tsx, TellOverlay.tsx):
 *  - plays a portrait clip filling the stage (`cover`) and anything wider whole
 *    (`contain`), per `fitFor`;
 *  - during the double take shows every clip whole (`fit = inspecting ? 'contain' :
 *    baseFit`), zooming a portrait clip out from cover with a scale (`coverScale`)
 *    so the change is continuous;
 *  - maps a tell's box onto the stage with `videoRect` + `boxOnStage`;
 *  - insets the whole stage (video and overlay together) by `inspectInset`.
 * placement.test.ts checks those lines are still what the app does.
 */
import { boxOnStage, fitFor, videoRect, type Box, type Fit } from '../../../src/feed/tells.ts';
import { inspectInset } from '../../../src/feed/shrink.ts';

export type Mode = 'play' | 'doubleTake';

/** The fit the app uses for a clip: cover or contain while playing, always contain in the double take. */
export function appFit(aspect: number, mode: Mode): Fit {
  return mode === 'doubleTake' ? 'contain' : fitFor(aspect);
}

/**
 * How much the app scales a contained portrait clip so it looks like cover while it
 * plays (1 in the double take, and for clips shown whole anyway).
 */
export function coverScale(stageW: number, stageH: number, aspect: number, mode: Mode): number {
  if (mode === 'doubleTake' || fitFor(aspect) !== 'cover') return 1;
  const stageAspect = stageW / stageH;
  return Math.max(aspect / stageAspect, stageAspect / aspect);
}

/** The video frame on the stage, in stage px (overflows the stage for cover). */
export function frameFor(stageW: number, stageH: number, aspect: number, mode: Mode): Box {
  return videoRect(stageW, stageH, aspect, appFit(aspect, mode));
}

/** A tell's box on the stage, clipped to it (null when cropped away), exactly as TellOverlay computes it. */
export function areaFor(box: Box, stageW: number, stageH: number, aspect: number, mode: Mode): Box | null {
  return boxOnStage(box, frameFor(stageW, stageH, aspect, mode), stageW, stageH);
}

/** The double take's inset: the whole stage scaled about its centre and moved down by `dy`. */
export function stageInset(stageW: number, stageH: number, cornerRadius: number) {
  return inspectInset(stageW, stageH, cornerRadius);
}

/** Where a stage point lands once the inset applies (`translateY(dy) scale(scale)` about the centre). */
export function insetPoint(x: number, y: number, stageW: number, stageH: number, inset: { scale: number; dy: number }) {
  return { x: stageW / 2 + (x - stageW / 2) * inset.scale, y: stageH / 2 + inset.dy + (y - stageH / 2) * inset.scale };
}
