/** Tutorial progress is earned only by opening a double take, never by viewing the hint. */
export const SHOW_DELAY_MS = 1000;
export const HINT_DELAYS = [1000, 1500, 1800, 2000, 3000] as const;
export interface HintProgress { opened: boolean }
export const FRESH: Readonly<HintProgress> = Object.freeze({ opened: false });
export type HintForce = 'off' | 'doubleTake';
export interface ClipContext {
  hasTells: boolean;
  blocked: boolean;
}
export function shouldShow(progress: HintProgress, clip: ClipContext, force: HintForce = 'off'): boolean {
  return !clip.blocked && clip.hasTells && (force === 'doubleTake' || !progress.opened);
}
export function recordOpen(progress: HintProgress): HintProgress {
  return progress.opened ? progress : { opened: true };
}
/** Old visibility flags are intentionally ignored. Legacy actual open counts still qualify. */
export function parseProgress(raw: string | null | undefined): HintProgress {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return { opened: !!value && (value.opened === true || (typeof value.opens === 'number' && Number.isFinite(value.opens) && value.opens >= 1)) };
  } catch {
    return { ...FRESH };
  }
}

/**
 * What the hint demonstrates: the viewer's gesture setting. Both is one demo,
 * not two in turn: a double tap, then a press and hold, under one caption.
 */
export type Demo = 'hold' | 'doubleTap' | 'both';

/** One pass of each demo, ms: short, so the whole hint stays brief. */
export const DEMO_MS: Readonly<Record<Demo, number>> = Object.freeze({ hold: 2600, doubleTap: 2000, both: 3800 });

/** The hint's only words. A fine pointer selects the desktop Space gestures. */
export function demoCaption(demo: Demo, input: { mouse: boolean }): string {
  if (demo === 'both') return input.mouse ? 'Hold or double-tap Space' : 'Hold or double tap';
  if (demo === 'doubleTap') return input.mouse ? 'Double-tap Space' : 'Double tap';
  return input.mouse ? 'Hold Space' : 'Hold';
}
