import type { Preset, Trial, TrialValues } from './trials';

function trial<const V extends string>(
  group: string,
  label: string,
  param: string,
  items: readonly { value: V; label: string }[],
): Trial<V> {
  return { group, label, param, items };
}

const LOOK = 'Look';
const WORDS = 'Words';
const PAGE = 'Page';
const LAUNCH = 'Launch';
const ARRIVE = 'Arrive';

/** The landing page's designs on trial, each picked with `?<param>=`. */
export const LANDING_TRIALS = {
  // ---- Look --------------------------------------------------------------
  gallery: trial(LOOK, 'Gallery', 'gallery', [
    { value: 'marquee', label: 'Rows streaming past' },
    { value: 'columns', label: 'Columns up and down' },
    { value: 'tilted', label: 'Tilted plane' },
    { value: 'mosaic', label: 'Video wall' },
    { value: 'orbit', label: 'Orbit' },
    { value: 'scatter', label: 'Depth of field' },
    { value: 'tunnel', label: 'Tunnel' },
    { value: 'phone', label: 'Phone in front' },
    { value: 'filmstrip', label: 'One filmstrip' },
  ]),
  blur: trial(LOOK, 'Blur', 'blur', [
    { value: 'soft', label: 'Soft' },
    { value: 'heavy', label: 'Heavy' },
    { value: 'edges', label: 'Edges only' },
    { value: 'lens', label: 'Clear under the cursor' },
    { value: 'none', label: 'None' },
  ]),
  veil: trial(LOOK, 'Shade', 'veil', [
    { value: 'radial', label: 'Darker in the middle' },
    { value: 'bottom', label: 'Darker at the bottom' },
    { value: 'flat', label: 'Even' },
    { value: 'spot', label: 'Behind the words only' },
  ]),
  dim: trial(LOOK, 'How dark', 'dim', [
    { value: '35', label: 'Light' },
    { value: '55', label: 'Medium' },
    { value: '75', label: 'Dark' },
  ]),
  speed: trial(LOOK, 'Drift', 'speed', [
    { value: 'slow', label: 'Slow' },
    { value: 'medium', label: 'Medium' },
    { value: 'fast', label: 'Fast' },
  ]),
  reels: trial(LOOK, 'Tiles swipe to the next clip', 'reels', [
    { value: 'end', label: 'As each clip ends' },
    { value: 'off', label: 'Never (clips loop)' },
  ]),
  busy: trial(LOOK, 'How busy the wall is', 'busy', [
    { value: 'medium', label: 'Medium' },
    { value: 'calm', label: 'Calm' },
    { value: 'lively', label: 'Lively' },
  ]),
  turn: trial(LOOK, 'Next clip comes in by', 'turn', [
    { value: 'auto', label: 'Swipe; a crossfade on phones' },
    { value: 'slide', label: 'Swiping up' },
    { value: 'fade', label: 'Crossfading' },
  ]),
  scan: trial(LOOK, 'On the tiles', 'scan', [
    { value: 'brackets', label: 'Tell boxes flicker on' },
    { value: 'labels', label: '“Real?” “AI?” chips' },
    { value: 'none', label: 'Nothing' },
  ]),

  // ---- Words -------------------------------------------------------------
  copy: trial(WORDS, 'Words', 'copy', [
    { value: 'second', label: 'Take a second look.' },
    { value: 'realai', label: 'Real or AI?' },
    { value: 'twice', label: 'Look twice.' },
    { value: 'fool', label: 'Would this fool you?' },
    { value: 'train', label: 'Train your eye' },
    { value: 'tells', label: 'Learn the tells.' },
  ]),
  type: trial(WORDS, 'Type', 'type', [
    { value: 'grotesk', label: 'Grotesk' },
    { value: 'serif', label: 'Display serif' },
    { value: 'condensed', label: 'Condensed caps' },
    { value: 'mono', label: 'Mono' },
    { value: 'rounded', label: 'Rounded' },
  ]),
  emphasis: trial(WORDS, 'Key word', 'emphasis', [
    { value: 'bracket', label: 'In a tell box' },
    { value: 'strike', label: 'Struck, then fixed' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'glitch', label: 'Glitch' },
    { value: 'underline', label: 'Drawn underline' },
    { value: 'none', label: 'None' },
  ]),
  layout: trial(WORDS, 'Words sit', 'layout', [
    { value: 'center', label: 'Centered' },
    { value: 'left', label: 'Left' },
    { value: 'bottom', label: 'Bottom left' },
    { value: 'split', label: 'Split with the gallery' },
  ]),
  cta: trial(WORDS, 'Button', 'cta', [
    { value: 'pill', label: 'White pill' },
    { value: 'glass', label: 'Glass' },
    { value: 'accent', label: 'Accent' },
    { value: 'play', label: 'Play circle' },
  ]),
  accent: trial(WORDS, 'Accent', 'accent', [
    { value: 'blue', label: 'App blue' },
    { value: 'coral', label: 'Coral' },
    { value: 'lime', label: 'Lime' },
    { value: 'white', label: 'White' },
  ]),

  // ---- Page --------------------------------------------------------------
  tier: trial(PAGE, 'Lighter for phones', 'tier', [
    { value: 'auto', label: 'When the device needs it' },
    { value: 'full', label: 'Never' },
    { value: 'phone', label: 'Always' },
  ]),
  header: trial(PAGE, 'Header', 'header', [
    { value: 'full', label: 'Logo, links, button' },
    { value: 'logo', label: 'Logo only' },
    { value: 'none', label: 'None' },
  ]),
  below: trial(PAGE, 'Below the hero', 'below', [
    { value: 'full', label: 'How it works, tells, try one' },
    { value: 'steps', label: 'How it works' },
    { value: 'quiz', label: 'Try one' },
    { value: 'none', label: 'Nothing' },
  ]),

  // ---- Launch ------------------------------------------------------------
  motion: trial(LAUNCH, 'Gallery on press', 'motion', [
    { value: 'coast', label: 'Coasts to a slow stop' },
    { value: 'decelerate', label: 'Slows to a stop' },
    { value: 'freeze', label: 'Stops at once' },
    { value: 'flow', label: 'Keeps moving' },
  ]),
  pick: trial(LAUNCH, 'Video that stays', 'pick', [
    { value: 'center', label: 'Nearest the middle' },
    { value: 'button', label: 'Nearest the button' },
    { value: 'random', label: 'Any on screen' },
  ]),
  order: trial(LAUNCH, 'Others leave', 'order', [
    { value: 'random', label: 'At random' },
    { value: 'outward', label: 'Out from the one that stays' },
    { value: 'inward', label: 'In toward it' },
    { value: 'sweep', label: 'Left to right' },
    { value: 'rows', label: 'Top down' },
    { value: 'together', label: 'All at once' },
  ]),
  vanish: trial(LAUNCH, 'Each leaves by', 'vanish', [
    { value: 'fade', label: 'Fading' },
    { value: 'shrink', label: 'Shrinking' },
    { value: 'blur', label: 'Blurring away' },
    { value: 'drop', label: 'Dropping' },
    { value: 'recede', label: 'Sinking back into the plane' },
    { value: 'flip', label: 'Flipping over' },
  ]),
  sink: trial(LAUNCH, 'Sinking takes', 'sink', [
    { value: '3000', label: '3 s' },
    { value: '4500', label: '4.5 s' },
    { value: '2000', label: '2 s' },
    { value: '1000', label: '1 s' },
  ]),
  depth: trial(LAUNCH, 'Sinks how far', 'depth', [
    { value: 'medium', label: 'Well back' },
    { value: 'shallow', label: 'A little' },
    { value: 'deep', label: 'Far away' },
  ]),
  start: trial(LAUNCH, 'Picked clip moves after (phone)', 'start', [
    { value: 'auto', label: 'Default: 1.4 s' },
    { value: '1700', label: '1.7 s' },
    { value: '1400', label: '1.4 s' },
    { value: '1000', label: '1 s' },
    { value: '600', label: '0.6 s' },
    { value: '2000', label: '2 s' },
    { value: '2500', label: '2.5 s' },
    { value: '3000', label: '3 s' },
  ]),
  growth: trial(LAUNCH, 'It grows (phone)', 'growth', [
    { value: 'medium', label: 'Steadily' },
    { value: 'slow', label: 'Slowly' },
    { value: 'fast', label: 'Quickly' },
  ]),
  fade: trial(LAUNCH, 'The rest fades out (phone)', 'fade', [
    { value: 'slower', label: 'Slowly' },
    { value: 'slow', label: 'Sooner' },
    { value: 'slowest', label: 'Very slowly' },
  ]),
  pace: trial(LAUNCH, 'Leaving takes', 'pace', [
    { value: '1000', label: '1s' },
    { value: '1800', label: '1.8s' },
    { value: '2600', label: '2.6s' },
    { value: '3400', label: '3.4s' },
  ]),
  focus: trial(LAUNCH, 'It sharpens', 'focus', [
    { value: 'early', label: 'At once' },
    { value: 'gradual', label: 'As the others leave' },
    { value: 'late', label: 'As it grows' },
  ]),
  beat: trial(LAUNCH, 'Alone, it', 'beat', [
    { value: 'brackets', label: 'Gets a tell box' },
    { value: 'pulse', label: 'Pulses' },
    { value: 'label', label: 'Asks “Real or AI?”' },
    { value: 'none', label: 'Just grows' },
  ]),
  grow: trial(LAUNCH, 'Grows', 'grow', [
    { value: 'straight', label: 'Straight there' },
    { value: 'lift', label: 'To the middle, then out' },
    { value: 'spring', label: 'With a spring' },
    { value: 'slow', label: 'Slowly' },
  ]),
  words: trial(LAUNCH, 'Words leave', 'words', [
    { value: 'lift', label: 'Fade and lift' },
    { value: 'fade', label: 'Fade' },
    { value: 'blur', label: 'Blur' },
    { value: 'drop', label: 'Fade and drop' },
  ]),

  // ---- Arrive ------------------------------------------------------------
  arrive: trial(ARRIVE, 'App comes in', 'arrive', [
    { value: 'stagger', label: 'Piece by piece' },
    { value: 'slide', label: 'Slides in from the edges' },
    { value: 'fade', label: 'Fades in' },
    { value: 'instant', label: 'At once' },
  ]),
  sound: trial(ARRIVE, 'Sound', 'sound', [
    { value: 'fade', label: 'Fades in as it grows' },
    { value: 'arrival', label: 'On arrival' },
    { value: 'muted', label: 'Stays muted' },
  ]),
};

export type LandingTrials = typeof LANDING_TRIALS;
export type LandingValues = TrialValues<LandingTrials>;

const BASE: LandingValues = {
  gallery: 'marquee',
  blur: 'soft',
  veil: 'radial',
  dim: '55',
  speed: 'medium',
  reels: 'end',
  turn: 'auto',
  busy: 'medium',
  scan: 'brackets',
  copy: 'second',
  type: 'grotesk',
  emphasis: 'bracket',
  layout: 'center',
  cta: 'pill',
  accent: 'blue',
  tier: 'auto',
  header: 'full',
  below: 'full',
  motion: 'decelerate',
  pick: 'center',
  order: 'random',
  vanish: 'fade',
  sink: '3000',
  depth: 'medium',
  pace: '1800',
  start: 'auto',
  growth: 'medium',
  fade: 'slower',
  focus: 'gradual',
  beat: 'brackets',
  grow: 'straight',
  words: 'lift',
  arrive: 'stagger',
  sound: 'fade',
};

function preset(id: string, label: string, note: string, values: Partial<LandingValues>): Preset<LandingTrials> {
  return { id, label, note, values: { ...BASE, ...values } };
}

/** Whole designs; the bar's ‹ › step through these. */
export const LANDING_PRESETS: readonly Preset<LandingTrials>[] = [
  preset('marquee', 'Marquee', 'Rows of clips stream past a soft blur; the middle one gets a tell box and grows.', {}),
  preset('columns', 'Columns', 'Columns scroll up and down like feeds; serif words sit bottom left.', {
    gallery: 'columns',
    blur: 'heavy',
    veil: 'bottom',
    copy: 'realai',
    type: 'serif',
    emphasis: 'strike',
    layout: 'bottom',
    cta: 'glass',
    accent: 'white',
    scan: 'labels',
    vanish: 'shrink',
    beat: 'pulse',
    grow: 'lift',
    focus: 'late',
  }),
  preset('tilted', 'Tilted plane', 'A wall of clips tilted in 3D, sharp and dark; loud condensed caps.', {
    gallery: 'tilted',
    header: 'none',
    motion: 'coast',
    blur: 'none',
    dim: '75',
    copy: 'twice',
    type: 'condensed',
    emphasis: 'glitch',
    cta: 'accent',
    accent: 'coral',
    scan: 'none',
    vanish: 'recede',
    grow: 'spring',
    beat: 'none',
  }),
  preset('wall', 'Video wall', 'A dense grid of clips, sharp in the middle and blurred at the edges.', {
    gallery: 'mosaic',
    blur: 'edges',
    veil: 'spot',
    copy: 'fool',
    emphasis: 'underline',
    accent: 'lime',
    vanish: 'flip',
    beat: 'label',
    speed: 'slow',
  }),
  preset('orbit', 'Orbit', 'A ring of clips turns around the words; the one in front stays.', {
    gallery: 'orbit',
    veil: 'flat',
    dim: '35',
    copy: 'tells',
    type: 'serif',
    emphasis: 'gradient',
    cta: 'play',
    accent: 'white',
    header: 'logo',
    below: 'steps',
    pace: '2600',
    grow: 'slow',
    focus: 'early',
    scan: 'none',
  }),
  preset('depth', 'Depth of field', 'Clips float at different depths, the far ones out of focus.', {
    gallery: 'scatter',
    blur: 'none',
    copy: 'train',
    type: 'rounded',
    cta: 'glass',
    vanish: 'blur',
    speed: 'slow',
  }),
  preset('tunnel', 'Tunnel', 'Clips fly toward you out of the dark; mono type, lime button.', {
    gallery: 'tunnel',
    blur: 'none',
    copy: 'second',
    type: 'mono',
    emphasis: 'glitch',
    cta: 'accent',
    accent: 'lime',
    motion: 'freeze',
    vanish: 'shrink',
    pace: '1000',
    scan: 'none',
    grow: 'lift',
  }),
  preset('phone', 'Phone in front', 'A phone plays the feed in front of a blurred wall; its video becomes the app.', {
    gallery: 'phone',
    blur: 'heavy',
    veil: 'flat',
    layout: 'left',
    copy: 'realai',
    emphasis: 'bracket',
    beat: 'none',
    pace: '1000',
    grow: 'straight',
    scan: 'none',
    arrive: 'slide',
  }),
  preset('lens', 'Look closer', 'Everything is blurred except where you point; serif and quiet.', {
    gallery: 'mosaic',
    blur: 'lens',
    copy: 'twice',
    type: 'serif',
    emphasis: 'bracket',
    scan: 'none',
    below: 'quiz',
    pick: 'button',
  }),
  preset('editorial', 'Editorial', 'Big serif words on black over one filmstrip of clips; coral accents.', {
    gallery: 'filmstrip',
    blur: 'none',
    veil: 'bottom',
    dim: '35',
    copy: 'tells',
    type: 'serif',
    emphasis: 'underline',
    layout: 'left',
    accent: 'coral',
    scan: 'labels',
    vanish: 'drop',
    grow: 'lift',
    focus: 'early',
  }),
  preset('split', 'Split screen', 'Words on the left, a column wall on the right, nothing blurred.', {
    gallery: 'columns',
    blur: 'none',
    veil: 'spot',
    dim: '35',
    layout: 'split',
    copy: 'fool',
    cta: 'accent',
    vanish: 'fade',
    pick: 'button',
    speed: 'slow',
    beat: 'label',
  }),
  preset('quiet', 'Quiet', 'Barely-there blurred wall, no header, the slowest launch, no sound.', {
    gallery: 'mosaic',
    blur: 'heavy',
    dim: '75',
    veil: 'flat',
    copy: 'second',
    emphasis: 'none',
    cta: 'glass',
    header: 'none',
    below: 'none',
    scan: 'none',
    pace: '3400',
    grow: 'slow',
    beat: 'none',
    arrive: 'fade',
    sound: 'muted',
    speed: 'slow',
  }),
];

/** The design shown without a `?design=` (and the only one in production). The bar keeps its order. */
export const DEFAULT_LANDING_PRESET = 'tilted';

export const LANDING_STORAGE_PREFIX = 'landing:design:';
