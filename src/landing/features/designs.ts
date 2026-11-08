import type { Preset, Trial, TrialValues } from '../trials';

function trial<const V extends string>(
  group: string,
  label: string,
  param: string,
  items: readonly { value: V; label: string }[],
): Trial<V> {
  return { group, label, param, items };
}

const LOOK = 'Look';
const MOTION = 'Motion';
const SECTIONS = 'Sections';

const onOff = [
  { value: 'on', label: 'Shown' },
  { value: 'off', label: 'Hidden' },
] as const;

/**
 * The features section's designs on trial (the part below the hero), each
 * picked with `?<param>=`, separate from the hero's: their params all start
 * with `f`, and a whole design is `?fdesign=`.
 */
export const FEATURE_TRIALS = {
  // ---- Look --------------------------------------------------------------
  layout: trial(LOOK, 'Direction', 'flayout', [
    { value: 'side', label: 'Sticky phone, copy beside it' },
    { value: 'stage', label: 'Center stage' },
    { value: 'rail', label: 'Horizontal story rail' },
  ]),
  device: trial(LOOK, 'Phone', 'fdevice', [
    { value: 'titanium', label: 'Titanium' },
    { value: 'black', label: 'Black' },
    { value: 'bare', label: 'Screen only' },
  ]),
  glow: trial(LOOK, 'Behind the phone', 'fglow', [
    { value: 'soft', label: 'Soft glow' },
    { value: 'none', label: 'Nothing' },
    { value: 'poster', label: 'The clip, blurred' },
  ]),
  cta: trial(LOOK, 'Last call to action', 'fcta', [
    { value: 'quiz', label: 'Real or AI? on three clips' },
    { value: 'phone', label: 'The phone becomes the app' },
    { value: 'score', label: 'A score to beat' },
    { value: 'wall', label: 'The wall comes back' },
    { value: 'plain', label: 'Heading and button' },
  ]),
  nav: trial(LOOK, 'Section index', 'fnav', [
    { value: 'dots', label: 'Labels with a line' },
    { value: 'none', label: 'None' },
  ]),

  // ---- Motion ------------------------------------------------------------
  length: trial(MOTION, 'Scroll per section', 'flength', [
    { value: 'medium', label: 'Medium' },
    { value: 'short', label: 'Short' },
    { value: 'long', label: 'Long' },
  ]),
  follow: trial(MOTION, 'Follows the scroll', 'ffollow', [
    { value: 'smooth', label: 'With a little glide' },
    { value: 'direct', label: 'Exactly' },
    { value: 'floaty', label: 'Loosely' },
  ]),
  pop: trial(MOTION, 'Cards out of the screen', 'fpop', [
    { value: 'full', label: 'Out beside the phone' },
    { value: 'subtle', label: 'A little' },
    { value: 'wild', label: 'Far, in 3D' },
    { value: 'off', label: 'Stay on screen' },
  ]),
  tilt: trial(MOTION, 'Phone turns', 'ftilt', [
    { value: 'some', label: 'A little' },
    { value: 'none', label: 'Never' },
    { value: 'more', label: 'More' },
  ]),
  steps: trial(MOTION, 'Walkthrough steps', 'fsteps', [
    { value: '3', label: '3' },
    { value: '2', label: '2' },
    { value: '4', label: '4' },
  ]),

  // ---- Sections ----------------------------------------------------------
  scroll: trial(SECTIONS, 'Scroll and the walkthrough', 'fscroll', onOff),
  upload: trial(SECTIONS, 'Upload', 'fupload', onOff),
  game: trial(SECTIONS, 'Game', 'fgame', onOff),
  skills: trial(SECTIONS, 'Skills', 'fskills', onOff),
  account: trial(SECTIONS, 'Profile', 'faccount', onOff),
} as const;

export type FeatureTrials = typeof FEATURE_TRIALS;
export type FeatureValues = TrialValues<FeatureTrials>;

const BASE: FeatureValues = {
  layout: 'side',
  device: 'titanium',
  glow: 'soft',
  cta: 'quiz',
  nav: 'dots',
  length: 'medium',
  follow: 'smooth',
  pop: 'full',
  tilt: 'some',
  steps: '3',
  scroll: 'on',
  upload: 'on',
  game: 'on',
  skills: 'on',
  account: 'on',
};

export const FEATURE_PRESETS: readonly Preset<FeatureTrials>[] = [
  {
    id: 'side',
    label: 'Sticky phone',
    note: 'The phone stays put on the right while the words change beside it. Cards come out to the right.',
    values: BASE,
  },
  {
    id: 'stage',
    label: 'Center stage',
    note: 'The phone in the middle, big words behind it. Cards come out to both sides, further, in 3D.',
    values: { ...BASE, layout: 'stage', pop: 'wild', tilt: 'more', glow: 'poster', cta: 'phone' },
  },
  {
    id: 'rail',
    label: 'Story rail',
    note: 'Scrolling moves a row of panels sideways past the phone; cards land on the panel.',
    values: { ...BASE, layout: 'rail', device: 'black', tilt: 'none', cta: 'wall' },
  },
];

/** Shown when nothing else picks one (Kenny's pick for now). */
export const DEFAULT_FEATURES_PRESET = 'stage';

export const FEATURES_STORAGE_PREFIX = 'dt-landing-features:';
export const FEATURES_PRESET_PARAM = 'fdesign';

/** Page-wide development aids (the Global tab). */
export const GLOBAL_TRIALS = {
  meter: trial('Development', 'Frame time meter', 'fmeter', [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]),
} as const;

export type GlobalTrials = typeof GLOBAL_TRIALS;

export const GLOBAL_PRESETS: readonly Preset<GlobalTrials>[] = [
  { id: 'default', label: 'Global', note: 'Page-wide aids for development.', values: { meter: 'off' } },
];
