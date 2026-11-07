/**
 * Step-by-step walkthrough of a clip's tells: pause on each one in turn,
 * outline it, and explain it, with an honest note on where it came from.
 * Pure, so the step order, seek times and wording are unit-tested.
 */
import type { Tell } from './format.ts';

/** Seconds of slack around each tell's window; `timeUpdate` only arrives every 250 ms. */
export const TELL_SLACK = 0.3;

/** Tells visible at playback time `t`. */
export function activeTells(tells: Tell[], t: number, slack = TELL_SLACK): Tell[] {
  return tells.filter((x) => t >= x.t0 - slack && t <= x.t1 + slack);
}

/** Walkthrough order: by the moment each tell is best seen. */
export function walkthroughSteps(tells: Tell[]): Tell[] {
  return [...tells].sort((a, b) => seekTimeFor(a) - seekTimeFor(b) || a.t0 - b.t0);
}

/** Where a step pauses: its focus frame, else a beat into its window (never outside it). */
export function seekTimeFor(t: Tell): number {
  const at = t.focusT ?? t.t0 + Math.min(0.3, (t.t1 - t.t0) / 2);
  return Math.max(0, Math.min(t.t1, Math.max(t.t0, at)));
}

export interface StepCopy {
  /** "Step 2 of 3" */
  position: string;
  /** Where the claim comes from, e.g. "Community Note". */
  source: string;
  /** How far it's been checked, e.g. "AI draft · not verified". */
  status: string;
  /** True when the UI should flag the step as unverified. */
  unverified: boolean;
  /** Extra caution shown under the explanation, if any. */
  caveat?: string;
}

export function stepCopy(t: Tell, i: number, n: number): StepCopy {
  const source =
    t.source === 'community_note'
      ? 'Community Note'
      : t.source === 'comment'
        ? `Comment${t.evidence?.author ? ` by @${t.evidence.author}` : ''}`
        : t.source === 'model'
          ? 'Spotted by the model'
          : 'Double Take';
  const review = t.review ?? (t.source === 'model' ? 'unreviewed' : undefined);
  const status =
    review === 'verified'
      ? 'Verified'
      : review === 'spot_checked'
        ? 'Checked on frames'
        : review === 'unreviewed'
          ? 'AI draft · not verified'
          : 'Not verified';
  let caveat: string | undefined;
  if (!t.box) caveat = t.seenInFrames === false ? "The model couldn't find this in the frames." : 'No region to outline for this one.';
  else if (t.pixelCheck === 'unchanged') caveat = "This spot barely changes in the frames we checked, so the claim may be wrong.";
  else if (review === 'unreviewed') caveat = `Box placed by ${modelName(t.model)}. It may be off.`;
  return { position: `Step ${i + 1} of ${n}`, source, status, unverified: review !== 'verified' && review !== 'spot_checked', caveat };
}

/** "nvidia/nemotron-3.5-super-vl-120b-a12b" → "NVIDIA Nemotron"; anything else → "an AI model". */
function modelName(id: string | undefined): string {
  if (!id) return 'an AI model';
  return /nemotron/i.test(id) ? 'NVIDIA Nemotron' : /nvidia/i.test(id) ? 'an NVIDIA model' : 'an AI model';
}

export interface Moment {
  label: 'Before' | 'After';
  t: number;
  /** True for the moment the box was drawn on. */
  isFocus: boolean;
}

/** The two moments of a before/after tell, in time order; null when there's no comparison. */
export function compareMoments(t: Tell): [Moment, Moment] | null {
  if (t.compareT === undefined || !t.box) return null;
  const focus = seekTimeFor(t);
  if (Math.abs(t.compareT - focus) < 0.05) return null;
  const a = { t: focus, isFocus: true };
  const b = { t: t.compareT, isFocus: false };
  const [first, second] = a.t < b.t ? [a, b] : [b, a];
  return [
    { label: 'Before', ...first },
    { label: 'After', ...second },
  ];
}
