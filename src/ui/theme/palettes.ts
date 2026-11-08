/**
 * The app's colour palettes: every colour that should change with the look of
 * the app, in one place. Pure (no React Native), so it runs under `node --test`;
 * `index.ts` picks the live palette and binds it to React and to CSS.
 *
 * Colours that stay the same everywhere (white text over video, the black
 * scrims behind it) stay where they are used.
 */

export const PALETTE_IDS = ['mono', 'glacier', 'ultraviolet', 'yellow'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export interface Palette {
  id: PaletteId;
  name: string;
  /** One line for the dev switcher. */
  blurb: string;

  /** Controls: the picked chip, radio, switch, primary button, the open dev launcher. */
  accent: string;
  /** Text and icons on `accent`. */
  onAccent: string;
  /** `accent` at low alpha, for borders and tints. */
  accentSoft: string;

  /** The AI verdict chip. */
  ai: string;
  /** Text and icons on `ai`. */
  onAi: string;
  /** The double take: tell boxes, walkthrough progress and pill, the button while it's on. */
  tell: string;
  /** Text and icons on `tell`. */
  onTell: string;
  /** The Not AI verdict chip: glass over the video, set apart from AI by its fill. */
  real: string;
  realBorder: string;
  onReal: string;

  /** Keyboard focus rings. */
  focus: string;
  /** Text buttons and links, e.g. "Create an account", "Follow". */
  link: string;

  /** Page background, and the two stops of the desktop's glow behind the feed. */
  bg: string;
  bgGlow: string;
  bgDeep: string;
  /** Sheets, dialogs and cards; `surfaceRaised` for fields and hovers on them. */
  surface: string;
  surfaceRaised: string;
  text: string;
  textDim: string;

  like: string;
  repost: string;
  danger: string;
}

/** Shared by every palette: social colours people expect to mean the same thing everywhere. */
const SOCIAL = {
  like: '#ff3040',
  repost: '#3ccf91',
  danger: '#ff6961',
} as const;

const GLASS = {
  real: 'rgba(0,0,0,0.55)',
  realBorder: 'rgba(255,255,255,0.45)',
  onReal: '#ffffff',
} as const;

export const PALETTES: Readonly<Record<PaletteId, Palette>> = Object.freeze({
  mono: {
    id: 'mono',
    name: 'Mono + magenta',
    blurb: 'White controls on black; magenta only marks AI and its tells.',
    accent: '#f2f2f2',
    onAccent: '#0a0a0a',
    accentSoft: 'rgba(242,242,242,0.4)',
    // Magenta: rare in real footage, and clear of the like's red and the
    // repost's green for protan and deutan vision too.
    ai: '#ee6bff',
    onAi: '#1f0420',
    tell: '#ee6bff',
    onTell: '#1f0420',
    ...GLASS,
    focus: '#f2f2f2',
    link: '#ffffff',
    bg: '#0a0a0a',
    bgGlow: '#141414',
    bgDeep: '#080808',
    surface: '#1a1a1a',
    surfaceRaised: '#262626',
    text: '#f5f5f5',
    textDim: '#a6a6a6',
    ...SOCIAL,
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier',
    blurb: 'Cool slate surfaces with one soft ice-blue accent.',
    accent: '#8ccbff',
    onAccent: '#06121f',
    accentSoft: 'rgba(140,203,255,0.4)',
    ai: '#8ccbff',
    onAi: '#06121f',
    tell: '#8ccbff',
    onTell: '#06121f',
    ...GLASS,
    focus: '#8ccbff',
    link: '#8ccbff',
    bg: '#0a0d12',
    bgGlow: '#121924',
    bgDeep: '#080a0e',
    surface: '#161b23',
    surfaceRaised: '#212833',
    text: '#eef2f7',
    textDim: '#98a2b3',
    ...SOCIAL,
  },
  ultraviolet: {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    blurb: 'One bold violet for controls, AI and its tells.',
    accent: '#9b7bff',
    onAccent: '#0d0620',
    accentSoft: 'rgba(155,123,255,0.45)',
    ai: '#9b7bff',
    onAi: '#0d0620',
    // Lighter than the chip, so the outline holds up over dark footage.
    tell: '#b39dff',
    onTell: '#0d0620',
    ...GLASS,
    focus: '#b39dff',
    link: '#c4b5ff',
    bg: '#0b0b10',
    bgGlow: '#15131f',
    bgDeep: '#09090c',
    surface: '#1b1a22',
    surfaceRaised: '#26252f',
    text: '#f4f3f8',
    textDim: '#a3a3b2',
    ...SOCIAL,
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow (before)',
    blurb: 'The palette the app had: iOS system yellow, with a blue focus ring on desktop.',
    accent: '#ffd60a',
    onAccent: '#111111',
    accentSoft: 'rgba(255,214,10,0.45)',
    ai: '#ffd60a',
    onAi: '#111111',
    tell: '#ffd60a',
    onTell: '#111111',
    ...GLASS,
    focus: '#4f9cf9',
    link: '#8ab4ff',
    bg: '#0b0c0f',
    bgGlow: '#12151b',
    bgDeep: '#090a0c',
    surface: '#1b1d21',
    surfaceRaised: '#26282d',
    text: '#f5f5f5',
    textDim: '#a8a8a8',
    ...SOCIAL,
  },
});

/** The palette the app ships with; dev builds can switch it in Dev settings → Colors. */
export const DEFAULT_PALETTE: PaletteId = 'mono';

export function parsePaletteId(raw: unknown): PaletteId {
  return PALETTE_IDS.includes(raw as PaletteId) ? (raw as PaletteId) : DEFAULT_PALETTE;
}

/** The palette's colours as CSS custom properties: `onAccent` → `--dt-on-accent`. */
export function cssVariables(p: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'id' || k === 'name' || k === 'blurb') continue;
    out[`--dt-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v;
  }
  return out;
}

// ---- colour maths, for the palette tests ------------------------------------

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` → 0–1 sRGB channels. */
export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two opaque hex colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';

/** Machado, Oliveira & Fernandes (2009), full severity, on linear RGB. */
const CVD: Record<Exclude<Vision, 'normal'>, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function seen(hex: string, vision: Vision): Rgb {
  const lin = hexToRgb(hex).map(toLinear) as Rgb;
  if (vision === 'normal') return lin;
  return CVD[vision].map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))) as Rgb;
}

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720453 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How different two colours look (OKLab distance × 100) to someone with the given vision. */
export function difference(a: string, b: string, vision: Vision = 'normal'): number {
  const p = oklab(seen(a, vision));
  const q = oklab(seen(b, vision));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}
