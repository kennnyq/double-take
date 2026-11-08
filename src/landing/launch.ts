import { playerFor } from './AtlasPlayer';
import type { LandingValues } from './designs';
import { sendHandoff } from './handoff';
import { slowdown } from './slowdown';

/**
 * The launch: the gallery stops, its clips leave one by one until one is
 * left, and that one grows onto the feed's video, which carries on from the
 * same frame while the app's own pieces come in around it.
 *
 *   press ─ gallery slows ─ words leave
 *         └ others leave over `pace`, in `order` ─ beat ─ grow ─ arrive
 *
 * Everything here is DOM and Web Animations: the landing's React tree is not
 * re-rendered while it runs.
 */

export interface LaunchHooks {
  /** Mount the app beneath the landing, opened on `clip`. */
  mountApp(clip: number): void;
  /** The launch is over: the landing can go. */
  done(): void;
  /** The full clip at feed index `clip`, which the one that stays switches to. */
  fullSrc(clip: number): string | undefined;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const center = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function visibleFraction(r: DOMRect) {
  const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  return r.width && r.height ? (w * h) / (r.width * r.height) : 0;
}

async function until(test: () => boolean, limitMs: number) {
  const start = performance.now();
  while (!test() && performance.now() - start < limitMs) await frame();
}

// ---- Picking the one that stays ---------------------------------------

interface Measured {
  el: HTMLElement;
  r: DOMRect;
  seen: number;
}

function pickSurvivor(tiles: Measured[], pick: LandingValues['pick'], button: DOMRect | null, gallery: DOMRect): HTMLElement {
  // A phone in front (or any tile marked as the hero) wins: the one most in view.
  const heroes = tiles.filter((t) => t.el.hasAttribute('data-hero-tile'));
  if (heroes.length) {
    const box = heroes[0].el.closest('[data-clip-box]')?.getBoundingClientRect();
    const shown = (r: DOMRect) =>
      box ? Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)) : r.height;
    return heroes.reduce((a, b) => (shown(b.r) > shown(a.r) ? b : a)).el;
  }
  // Whole on screen, and among the biggest (far, tiny tiles don't count).
  const whole = tiles.filter((t) => t.seen > 0.9 && t.r.width > 40);
  const pool = whole.length ? whole : tiles.filter((t) => t.seen > 0);
  const widest = Math.max(...pool.map((t) => t.r.width));
  const big = pool.filter((t) => t.r.width >= widest * 0.6);
  if (pick === 'random') return big[Math.floor(Math.random() * big.length)].el;
  const to = pick === 'button' && button ? center(button) : center(gallery);
  const dist = (t: Measured) => Math.hypot(center(t.r).x - to.x, center(t.r).y - to.y);
  return big.reduce((a, b) => (dist(b) < dist(a) ? b : a)).el;
}

// ---- How each piece leaves -------------------------------------------

const WORD_EXITS: Record<LandingValues['words'], (from: string) => Keyframe[]> = {
  lift: (o) => [{ opacity: o, translate: '0 0' }, { opacity: 0, translate: '0 -14px' }],
  drop: (o) => [{ opacity: o, translate: '0 0' }, { opacity: 0, translate: '0 14px' }],
  fade: (o) => [{ opacity: o }, { opacity: 0 }],
  blur: (o) => [{ opacity: o, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(12px)' }],
};

const SINK_DEPTH: Record<LandingValues['depth'], number> = { shallow: 450, medium: 900, deep: 1600 };

/**
 * A slow sink: it starts to fade a third of the way down. `deep`: along its
 * plane's depth; otherwise it shrinks, to `scale` (projected: see `sinkOnPlane`)
 * or by how far it sinks.
 */
function recedeFrames(o: string, deep: boolean, px: number, scale = Math.max(0.3, 1 - px / 1800)): Keyframe[] {
  return [
    { opacity: o, translate: '0 0 0', scale: '1' },
    { offset: 0.35, opacity: o },
    { opacity: 0, translate: deep ? `0 0 -${px}px` : '0 0 0', scale: deep ? '1' : String(scale) },
  ];
}

/**
 * Where the eye is, in a tilted plane's own pixels (from its top left; `z` its
 * height above the plane), from its transform (`data-tilt`: a perspective and
 * rotations, about its middle).
 */
function eyeOnPlane(plane: HTMLElement): { x: number; y: number; z: number } | null {
  const tilt = plane.dataset.tilt;
  const d = Number(/perspective\(([\d.]+)px\)/.exec(tilt ?? '')?.[1]);
  if (!tilt || !d) return null;
  const eye = new DOMMatrix(tilt.replace(/perspective\([^)]*\)/, '').trim() || 'none').inverse().transformPoint(new DOMPoint(0, 0, d));
  return eye.z > 0 ? { x: eye.x + plane.offsetWidth / 2, y: eye.y + plane.offsetHeight / 2, z: eye.z } : null;
}

/**
 * A tile on a tilted plane sinking `px` back along the plane's normal, drawn
 * flat in the plane (no 3D context, which Safari redrew the whole plane for):
 * seen from the eye, the sunk tile is the flat one scaled about the point on
 * the plane under the eye, by its height over the plane against its height
 * over the sunk tile. Exact for a flat tile; it only drifts as far as its
 * strip still glides meanwhile.
 */
function sinkOnPlane(tile: HTMLElement, eye: { x: number; y: number; z: number }, px: number) {
  const strip = tile.offsetParent as HTMLElement | null;
  const m = strip ? new DOMMatrix(getComputedStyle(strip).transform === 'none' ? undefined : getComputedStyle(strip).transform) : new DOMMatrix();
  const x = tile.offsetLeft + (strip?.offsetLeft ?? 0) + m.m41;
  const y = tile.offsetTop + (strip?.offsetTop ?? 0) + m.m42;
  return { scale: eye.z / (eye.z + px), origin: `${eye.x - x}px ${eye.y - y}px` };
}

/** The recede exit with the design's own length and depth. */
function recede(v: LandingValues): (typeof VANISH)['recede'] {
  return { ...VANISH.recede, ms: Number(v.sink), frames: (o, _f, deep, scale) => recedeFrames(o, deep, SINK_DEPTH[v.depth], scale) };
}

/** How a tile leaves. `deep`: it sits on a plane kept in 3D for the launch, so it can move along the plane's own depth. */
const VANISH: Record<
  LandingValues['vanish'],
  { ms: number; easing: string; frames(o: string, f: string, deep: boolean, scale?: number): Keyframe[] }
> = {
  fade: { ms: 560, easing: 'ease-out', frames: (o) => [{ opacity: o }, { opacity: 0 }] },
  shrink: {
    ms: 560,
    easing: 'cubic-bezier(.4,0,.2,1)',
    frames: (o) => [
      { opacity: o, scale: '1' },
      { opacity: 0, scale: '0.55' },
    ],
  },
  blur: {
    ms: 640,
    easing: 'ease-out',
    frames: (o, f) => [
      { opacity: o, filter: f === 'none' ? 'blur(0px)' : f },
      { opacity: 0, filter: 'blur(16px)' },
    ],
  },
  drop: {
    ms: 620,
    // Build speed gently, then ease into the end of the drop.
    easing: 'cubic-bezier(.65,0,.35,1)',
    frames: (o) => [
      { opacity: o, translate: '0 0', rotate: '0deg' },
      { opacity: 0, translate: '0 70px', rotate: `${Math.random() < 0.5 ? -9 : 9}deg` },
    ],
  },
  // Back, away from the viewer, along the normal of the plane it lives on,
  // fading as it goes; on a flat gallery, the same depth read as shrinking.
  // How long and how far are designs on trial (`sink`, `depth`: see recede()).
  recede: {
    ms: 3000,
    easing: 'cubic-bezier(.35,0,.25,1)',
    frames: (o, _f, deep, scale) => recedeFrames(o, deep, 900, scale),
  },
  flip: {
    ms: 520,
    easing: 'cubic-bezier(.5,0,.75,.4)',
    frames: (o) => [
      { opacity: o, rotate: 'y 0deg' },
      { offset: 0.85, opacity: o, rotate: 'y 80deg' },
      { opacity: 0, rotate: 'y 90deg' },
    ],
  },
};

function turns(tiles: Measured[], order: LandingValues['order'], from: { x: number; y: number }) {
  if (order === 'random' || order === 'together') return tiles.map(() => (order === 'random' ? Math.random() : 0));
  const values = tiles.map(({ r }) => {
    const c = center(r);
    return order === 'sweep' ? c.x : order === 'rows' ? c.y : Math.hypot(c.x - from.x, c.y - from.y);
  });
  const least = Math.min(...values);
  const range = Math.max(...values) - least || 1;
  return values.map((v) => {
    const t = (v - least) / range;
    return order === 'inward' ? 1 - t : t;
  });
}

// ---- The app coming in -----------------------------------------------

const ACTIVE = '.slide[aria-current="true"]';
/**
 * The desktop layout's pieces, in the order they come in, and where each comes
 * from. The phone layout is React Native, so it simply appears under the clip.
 */
const CHROME: { sel: string; x?: number; y?: number }[] = [
  { sel: '.rail', x: -1 },
  { sel: `${ACTIVE} .d-info`, y: 1 },
  { sel: `${ACTIVE} .d-actions`, x: 1 },
  { sel: '.d-nav', x: 1 },
  { sel: `${ACTIVE} .mute-btn`, y: -0.5 },
  { sel: '.messages-pill', y: 1 },
  { sel: `${ACTIVE} .shade` },
];

function arriveChrome(style: LandingValues['arrive']) {
  if (style === 'instant') return;
  const pieces = CHROME.flatMap((c) => [...document.querySelectorAll<HTMLElement>(c.sel)].map((el) => ({ el, ...c })));
  const far = style === 'slide' ? 64 : 14;
  pieces.forEach(({ el, x = 0, y = 0 }, i) => {
    const from: Keyframe =
      style === 'fade' ? { opacity: 0 } : { opacity: 0, translate: `${x * far}px ${y * far}px` };
    const to: Keyframe = style === 'fade' ? { opacity: 1 } : { opacity: 1, translate: '0 0' };
    el.animate([from, to], {
      duration: style === 'fade' ? 360 : style === 'slide' ? 560 : 420,
      delay: style === 'stagger' ? 80 + i * 55 : style === 'slide' ? 40 + i * 18 : 60,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'backwards',
    });
  });
}

/** The feed's video box for `clip` once the app has jumped to it. */
/**
 * The phone feed's video on screen, under the landing: the top one at the
 * middle of the screen (the feed keeps a pool of full-screen players, stacked).
 */
function phoneFeedVideo(root: HTMLElement): HTMLVideoElement | null {
  for (const el of document.elementsFromPoint(innerWidth / 2, innerHeight / 2)) {
    if (root.contains(el)) continue;
    const x = el instanceof HTMLVideoElement ? el : el.querySelector('video');
    if (x && !x.hasAttribute('data-atlas')) return x;
  }
  return null;
}

function feedStage(clip: number): HTMLElement | null {
  const slot = [...document.querySelectorAll<HTMLElement>('.pool-slot')].find(
    (s) => !s.hidden && s.style.getPropertyValue('--i').trim() === String(clip),
  );
  return slot?.querySelector<HTMLElement>('.stage') ?? null;
}

// ---- Lifting the one that stays out of the gallery ---------------------

interface Lifted {
  /** Wears the gallery plane's 3D transform at first, then none. */
  frame: HTMLElement;
  layer: HTMLElement;
  frameRect: Rect;
  planeTransform: string;
  /** The same transform untilted: what the growth animates it to. */
  flatTransform: string;
  start: Keyframe;
  small: HTMLVideoElement;
  /** Where in its clip the small one is now. */
  time(): number;
}

/**
 * Moves the tile's own video (still playing) into a fixed layer above the
 * page, at the same place on screen, so it can grow out of whatever plane,
 * clip or blur it sat in.
 */
function lift(root: HTMLElement, tile: HTMLElement, startFilter: string): Lifted {
  const small = tile.querySelector('video')!;
  // Drawn by the gallery atlas: its canvas comes along and keeps playing.
  const board = tile.querySelector<HTMLCanvasElement>('canvas.lt-board');
  const player = board ? playerFor(root) : null;
  const plane = tile.closest<HTMLElement>('[data-plane]');
  const clipBox = tile.closest<HTMLElement>('[data-clip-box]');
  const radius = getComputedStyle(tile).borderTopLeftRadius;

  let frameRect: Rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  let planeTransform = 'none';
  let flatTransform = 'none';
  let origin = '50% 50%';
  let local: Rect;
  if (plane) {
    const cs = getComputedStyle(plane);
    // Its own functions where it declares them, so they interpolate one by one.
    planeTransform = plane.dataset.tilt ?? cs.transform;
    flatTransform = plane.dataset.untilt ?? 'none';
    origin = cs.transformOrigin;
    // Where the tile sits on the plane, measured flat (then its own transform back).
    const own = [plane.style.getPropertyValue('transform'), plane.style.getPropertyPriority('transform')] as const;
    plane.style.setProperty('transform', 'none', 'important');
    frameRect = plane.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    if (own[0]) plane.style.setProperty('transform', own[0], own[1]);
    else plane.style.removeProperty('transform');
    local = { left: r.left - frameRect.left, top: r.top - frameRect.top, width: r.width, height: r.height };
  } else {
    const r = tile.getBoundingClientRect();
    local = { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  let clip = 'inset(0px 0px 0px 0px)';
  let rad = radius;
  if (clipBox) {
    const b = clipBox.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    rad = getComputedStyle(clipBox).borderTopLeftRadius;
    clip = `inset(${Math.max(0, b.top - r.top)}px ${Math.max(0, r.right - b.right)}px ${Math.max(0, r.bottom - b.bottom)}px ${Math.max(0, b.left - r.left)}px round ${rad})`;
  }

  const f = document.createElement('div');
  f.className = 'lt-lift-frame';
  Object.assign(f.style, {
    left: `${frameRect.left}px`,
    top: `${frameRect.top}px`,
    width: `${frameRect.width}px`,
    height: `${frameRect.height}px`,
    transform: planeTransform,
    transformOrigin: origin,
  });
  const layer = document.createElement('div');
  layer.className = 'lt-lift';
  const start: Keyframe = {
    left: `${local.left}px`,
    top: `${local.top}px`,
    width: `${local.width}px`,
    height: `${local.height}px`,
    borderRadius: clipBox ? '0px' : radius,
    clipPath: clip,
    filter: startFilter,
  };
  Object.assign(layer.style, start);
  f.append(layer);
  // Inside the hero, under its words (landing.css): the button stays in front
  // of the one that grows until it has gone, rather than the two swapping.
  (root.querySelector('.lt-hero') ?? root).append(f);
  // Moved in the same task, the video keeps playing.
  layer.append(small);
  if (board) layer.append(board);
  else small.play().catch(() => {});
  tile.style.visibility = 'hidden';
  const cell = Number(tile.dataset.cell);
  const time = player ? () => player.clipTime(cell) : () => small.currentTime;
  return { frame: f, layer, frameRect, planeTransform, flatTransform, start, small, time };
}

/**
 * The growth as transforms: the layer is laid out once, in the video's shape,
 * as the box that covers the target, and each keyframe's box becomes a move
 * and an even scale of it (onto the video-shaped box covering that keyframe's
 * box), with a clip, in the layer's own pixels, cropping it to the keyframe's
 * box and rounding its corners. The video fills the layer, so at every
 * keyframe it shows as it would covering that box (as the feed's does, at
 * the end). Returns the new keyframes, the layer already re-laid out where it
 * was drawn.
 */
function growOnCompositor(L: Lifted, frames: Keyframe[], target: Rect, targetRadius: string, aspect: number, slid: { x: number; y: number }): Keyframe[] {
  const boxOf = (k: Keyframe): Rect => {
    const r = k as Record<string, string>;
    return { left: parseFloat(r.left), top: parseFloat(r.top), width: parseFloat(r.width), height: parseFloat(r.height) };
  };
  const t = { left: target.left - L.frameRect.left, top: target.top - L.frameRect.top, width: target.width, height: target.height };
  const boxes = frames.map((k, i) => (i === frames.length - 1 ? t : boxOf(k)));
  boxes[0] = { ...boxes[0], left: boxes[0].left + slid.x, top: boxes[0].top + slid.y };
  // The video-shaped box covering `b`, about its middle.
  const cover = (b: Rect): Rect => {
    const w = b.width / b.height > aspect ? b.width : b.height * aspect;
    const h = w / aspect;
    return { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h };
  };
  const box = cover(t);
  const px = (n: number) => `${+n.toFixed(3)}px`;
  const out: Keyframe[] = frames.map((k, i) => {
    const { left: _l, top: _t, width: _w, height: _h, borderRadius: _r, clipPath: _c, ...rest } = k as Record<string, string>;
    const b = boxes[i];
    const c = cover(b);
    const scale = c.width / box.width;
    // Its own clip (an inset, a rounding) where it has one, at its size.
    const m = /inset\(([^)]*?)(?:\s+round\s+([^)]*))?\)/.exec(i === frames.length - 1 ? '' : (_c ?? ''));
    const own = (m?.[1] ?? '0 0 0 0').trim().split(/\s+/).map(parseFloat);
    while (own.length < 4) own.push(own[own.length - 2] ?? own[0]);
    const round = i === frames.length - 1 ? parseFloat(targetRadius) || 0 : parseFloat(m?.[2] ?? _r ?? '0') || 0;
    const inset = [b.top - c.top + own[0], c.left + c.width - (b.left + b.width) + own[1], c.top + c.height - (b.top + b.height) + own[2], b.left - c.left + own[3]];
    return {
      ...rest,
      transform: `translate(${px(c.left - box.left)}, ${px(c.top - box.top)}) scale(${+scale.toFixed(5)})`,
      clipPath: `inset(${inset.map((n) => px(n / scale)).join(' ')} round ${px(round / scale)})`,
    };
  });
  Object.assign(L.layer.style, {
    left: px(box.left),
    top: px(box.top),
    width: px(box.width),
    height: px(box.height),
    borderRadius: '0px',
    translate: 'none',
    // Its own layer now, a few frames before it moves, not in the growth's first frame.
    willChange: 'transform',
    transformOrigin: '0 0',
    transform: String(out[0].transform),
    clipPath: String(out[0].clipPath),
  });
  return out;
}

/**
 * The full clip, at the small one's moment, faded in over it. It was started
 * at the press (`warm`), so here it only moves in: seeking and starting a
 * video as the growth began stalled Safari, and the growth's first frames
 * were lost (it leapt).
 */
async function sharpen(lifted: Lifted, hi: HTMLVideoElement, fadeMs = 360) {
  await until(() => hi.readyState >= 2, 600);
  if (hi.paused) {
    hi.currentTime = Math.min(lifted.time() + 0.06, (hi.duration || 8) - 0.05);
    await Promise.race([new Promise((r) => hi.addEventListener('seeked', r, { once: true })), wait(300)]);
  }
  hi.style.cssText = '';
  // Moved in the same task, it keeps playing.
  lifted.layer.append(hi);
  hi.play().catch(() => {});
  hi.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeMs, easing: 'ease-in-out', fill: 'forwards' });
}

/** Starts the full clip early, out of sight and in step with the tile's own clip, so it is playing by the time it shows. */
function warm(hi: HTMLVideoElement, root: HTMLElement, time: () => number) {
  // In the document (Safari won't play it detached), out of sight.
  hi.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  root.append(hi);
  const sync = () => {
    hi.currentTime = Math.min(time() + 0.05, (hi.duration || 8) - 0.05);
  };
  hi.addEventListener(
    'loadedmetadata',
    () => {
      sync();
      hi.play().catch(() => {});
    },
    { once: true },
  );
  // Loading took a moment while the tile played on: catch up once.
  hi.addEventListener(
    'playing',
    () => {
      if (Math.abs(hi.currentTime - time()) > 0.12) sync();
    },
    { once: true },
  );
}

// ---- The launch --------------------------------------------------------

/** No more of the others start to leave from this long before the growth starts (ms), so the two don't share a frame. */
const SETTLE_LEAD = 250;
/** How long it grows, against the grow style's own length (a design on trial: `growth`). */
const GROWTH: Record<LandingValues['growth'], number> = { fast: 1, medium: 1.25, slow: 1.6 };
/** How long the rest of the gallery takes to fade out, from the growth (ms; a design on trial: `fade`). */
const FADE: Record<LandingValues['fade'], number> = { slow: 2600, slower: 3400, slowest: 4400 };
/** An ease-out: fastest at first, ever gentler, with a long faint tail. */
const FADE_EASING = 'cubic-bezier(.33,.66,.5,1)';
/** Phone UI keeps its fade-relative reveal; desktop follows growth completion. */
const ARRIVE_THROUGH = 0.5;
const ARRIVE_LEAD_MS = 500;
/** As the chrome appears, gently speed up only the opacity animations. */
const FADE_ACCELERATE_MS = 600;
const FADE_FINAL_RATE = 1.7;
/** From the growth, the shade lifts over the fade's last part, from this far through. */
const SHADE_FROM = 0.7;
/** The shade over the rest no darker than this, the fade keeps it from ever brightening as the shade lifts. */
const SHADE_UNDER = 0.85;

/**
 * The fade from the growth, as keyframes: the wall's opacity (an ease-out,
 * fastest at first) and the shade's (held, then lifting over the last part).
 * Where the shade was up to SHADE_UNDER dark, the wall as seen (its opacity
 * times what the shade lets through) only ever darkens: as the shade lifts,
 * the wall's opacity falls that much faster.
 */
function fadeSteps(n = 32): { at: number; wall: number; shade: number }[] {
  const ease = (u: number) => (1 - u) ** 2;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  return Array.from({ length: n + 1 }, (_, i) => {
    const at = i / n;
    const shadeProgress = Math.max(0, Math.min(1, (at - SHADE_FROM) / (1 - SHADE_FROM)));
    const shade = 1 - smooth(shadeProgress);
    return { at, shade, wall: (ease(at) * (1 - SHADE_UNDER)) / (1 - SHADE_UNDER * shade) };
  });
}

/**
 * How the hero's shade and blur cover the point `p` on screen: how dark (the
 * shade's alpha, both layers together) and how blurred. It follows their
 * gradients in landing.css (.lt-veil's modes, .lt-blur's), so the one that
 * stays can come out from under them looking just as it did.
 */
function coverAt(root: HTMLElement, p: { x: number; y: number }): { alpha: number; blur: number } {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  // A gradient's alpha at `at` along it, between (position, alpha) stops.
  const ramp = (stops: [number, number][], at: number) => {
    if (at <= stops[0][0]) return clamp(stops[0][1]);
    for (let i = 1; i < stops.length; i++) {
      const [x0, a0] = stops[i - 1];
      const [x1, a1] = stops[i];
      if (at <= x1) return clamp(a0) + (clamp(a1) - clamp(a0)) * ((at - x0) / (x1 - x0));
    }
    return clamp(stops[stops.length - 1][1]);
  };
  let veilAlpha = 0;
  const veil = root.querySelector<HTMLElement>('.lt-veil');
  if (veil) {
    const r = veil.getBoundingClientRect();
    const cs = getComputedStyle(veil);
    const dim = parseFloat(cs.getPropertyValue('--dim')) || 0;
    const sx = r.left + ((parseFloat(cs.getPropertyValue('--spot-x')) || 50) / 100) * r.width;
    const sy = r.top + ((parseFloat(cs.getPropertyValue('--spot-y')) || 50) / 100) * r.height;
    const ellipse = (wx: number, wy: number) => Math.hypot((p.x - sx) / (wx * r.width), (p.y - sy) / (wy * r.height));
    const mode = veil.dataset.mode;
    const a =
      mode === 'radial'
        ? ramp([[0, dim + 0.28], [0.62, dim], [1, dim * 0.75]], ellipse(0.6, 0.55))
        : mode === 'spot'
          ? ramp([[0, 0.9], [0.55, 0.6], [1, dim * 0.4]], ellipse(0.42, 0.38))
          : mode === 'bottom'
            ? ramp([[0, 0.96], [0.45, dim + 0.1], [1, dim * 0.5]], (r.bottom - p.y) / r.height)
            : mode === 'flat'
              ? clamp(dim)
              : 0;
    veilAlpha = a * Number(cs.opacity);
  }
  let shadeAlpha = 0;
  let blur = 0;
  const blurEl = root.querySelector<HTMLElement>('.lt-blur');
  if (blurEl) {
    const cs = getComputedStyle(blurEl);
    const bg = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor)?.[1].split(/[\s,/]+/).filter(Boolean);
    shadeAlpha = (bg && bg.length > 3 ? Number(bg[3]) : 0) * Number(cs.opacity);
    const r = blurEl.getBoundingClientRect();
    const px = cs.backdropFilter && cs.backdropFilter !== 'none' ? parseFloat(cs.getPropertyValue('--b')) || 0 : 0;
    const mode = blurEl.dataset.mode;
    const masked =
      mode === 'edges'
        ? ramp([[0.35, 0], [1, 1]], Math.hypot((p.x - r.left - r.width / 2) / (0.34 * r.width), (p.y - r.top - r.height / 2) / (0.4 * r.height)))
        : mode === 'lens'
          ? (() => {
              const lx = parseFloat(cs.getPropertyValue('--lx'));
              const ly = parseFloat(cs.getPropertyValue('--ly'));
              const cx = r.left + (Number.isFinite(lx) ? lx : 0.78 * r.width);
              const cy = r.top + (Number.isFinite(ly) ? ly : 0.36 * r.height);
              return ramp([[0.55, 0], [1, 1]], Math.hypot(p.x - cx, p.y - cy) / 190);
            })()
          : 1;
    blur = px * masked * Number(cs.opacity);
  }
  return { alpha: 1 - (1 - veilAlpha) * (1 - shadeAlpha), blur };
}

const GROW: Record<LandingValues['grow'], { ms: number; easing: string }> = {
  straight: { ms: 850, easing: 'cubic-bezier(.2,.8,.2,1)' },
  lift: { ms: 1250, easing: 'linear' },
  spring: { ms: 980, easing: 'cubic-bezier(.34,1.32,.64,1)' },
  slow: { ms: 1500, easing: 'cubic-bezier(.65,0,.25,1)' },
};

/**
 * Replaces a strip's endless drift (a CSS animation from 0 to -50% of its
 * length, possibly reversed) with one eased glide to a stop: as far as the
 * slowdown's speed curve carries it (`stop.rate` = (1-t)^2 covers a third of
 * the full-speed distance), on the curve whose speed is that (ease-out cubic).
 * Kept within one copy of its tiles, where the picture is the same.
 */
function glideToStop(strip: HTMLElement, run: Animation, stop: { ms: number }): { x: number; y: number } | null {
  const timing = run.effect?.getTiming();
  const period = Number(timing?.duration);
  if (!period || !Number.isFinite(period)) return null;
  const y = strip.classList.contains('lt-col');
  const half = (y ? strip.offsetHeight : strip.offsetWidth) / 2;
  const m = new DOMMatrix(getComputedStyle(strip).transform);
  let from = y ? m.m42 : m.m41;
  const sign = timing?.direction === 'reverse' ? 1 : -1;
  const by = (sign * (half / period) * stop.ms) / 3;
  let to = from + by;
  if (to < -half) {
    from += half;
    to += half;
  } else if (to > 0) {
    from -= half;
    to -= half;
  }
  const move = (at: number) => (y ? `translateY(${at}px)` : `translateX(${at}px)`);
  run.cancel();
  strip.style.transform = move(from);
  const glide = strip.animate([{ transform: move(from) }, { transform: move(to) }], {
    duration: stop.ms,
    easing: GLIDE_EASING,
    fill: 'forwards',
  });
  // Started now, not on the next frame, which held every strip still for a frame at the press.
  glide.startTime = document.timeline.currentTime;
  return y ? { x: 0, y: to - from } : { x: to - from, y: 0 };
}

/** How a strip glides to a stop: at its own speed at first, slowing to rest. */
const GLIDE_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

export async function launch(root: HTMLElement, v: LandingValues, from: HTMLElement | null, hooks: LaunchHooks) {
  const alive = () => root.isConnected;
  const fromTile = from?.closest<HTMLElement>('[data-tile]') ?? null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Launched from further down: back to the hero first.
  if (!fromTile && root.scrollTop > 2) {
    root.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    await until(() => root.scrollTop <= 2, 900);
  }
  const deskFeed = innerWidth >= 760 && innerHeight >= 480;
  const startMs = v.start === 'auto' ? 1400 : Number(v.start);
  root.setAttribute('data-launching', '');
  // Tiles drawn a strip at a time by the atlas get a canvas of their own as
  // they leave, one by one, and keep playing until each has gone.
  const release = playerFor(root)?.release(root);

  const galleryEl = root.querySelector<HTMLElement>('.lt-gallery');
  const galleryRect = galleryEl?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  const button = from && !fromTile ? from.getBoundingClientRect() : null;
  const tiles: Measured[] = [...root.querySelectorAll<HTMLElement>('[data-tile]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, r, seen: visibleFraction(r) };
  });
  const survivor = fromTile ?? pickSurvivor(tiles, v.pick, button, galleryRect);
  release?.detach(survivor);
  const clip = Number(survivor.dataset.clip) || 0;
  // Desktop mounts now to measure the growth target, as in c901688. Phones
  // keep mounting after growth so rendering cannot stall their move.
  if (deskFeed) hooks.mountApp(clip);

  const hi = document.createElement('video');
  Object.assign(hi, { src: hooks.fullSrc(clip) ?? '', muted: true, loop: true, playsInline: true, preload: 'auto' });
  hi.className = 'lt-hi';
  hi.load();
  {
    const player = playerFor(root);
    const cell = Number(survivor.dataset.cell);
    if (player && !Number.isNaN(cell)) warm(hi, root, () => player.clipTime(cell));
  }

  if (reduce) {
    if (!deskFeed) hooks.mountApp(clip);
    await until(() => feedStage(clip) !== null, 1500);
    await root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished;
    if (alive()) hooks.done();
    return;
  }

  // ---- The gallery stops.
  const moving = [...root.querySelectorAll<HTMLElement>('.lt-gallery, .lt-front')].flatMap((el) =>
    el.getAnimations({ subtree: true }),
  );
  if (v.motion === 'freeze') moving.forEach((a) => a.pause());
  // ---- The others' timing: a long exit (a slow sink) is staggered over most
  // of its own length, and the one that stays starts to grow before the last go.
  const exit = v.vanish === 'recede' ? recede(v) : VANISH[v.vanish];
  const vanish = deskFeed && v.vanish === 'drop'
    ? { ...exit, easing: 'cubic-bezier(.5,0,.9,.5)' }
    : exit;
  const pace = Number(v.pace);
  const long = vanish.ms >= 1500;
  const spread = Math.max(pace - vanish.ms, long ? vanish.ms * 0.6 : 0);
  const stop = slowdown(v.motion, Math.max(pace, spread + vanish.ms));
  const glides = new Map<HTMLElement, { x: number; y: number; ms: number }>();
  if (stop) {
    // Strips glide to a stop in one animation each, on the compositor: from
    // where they are to where the slowdown would leave them. Changing their
    // playback rate every frame from script instead stalled them whenever the
    // page was busy, and in WebKit cost so much the exit ran at ~1 fps.
    const glided = new Set<Animation>();
    for (const strip of root.querySelectorAll<HTMLElement>('.lt-row, .lt-col')) {
      const run = strip.getAnimations()[0];
      const move = run && glideToStop(strip, run, stop);
      if (!move) continue;
      glided.add(run);
      glides.set(strip, { ...move, ms: stop.ms });
    }
    const rest = moving.filter((a) => !glided.has(a));
    const t0 = performance.now();
    const slow = () => {
      const t = Math.min(1, (performance.now() - t0) / stop.ms);
      rest.forEach((a) => (t >= 1 ? a.pause() : a.updatePlaybackRate(stop.rate(t))));
      if (t < 1 && rest.length && alive()) requestAnimationFrame(slow);
    };
    if (rest.length) requestAnimationFrame(slow);
  }
  root.querySelectorAll<HTMLElement>('.lt-scan').forEach((el) => el.remove());

  // ---- The words, header and everything below leave at once.
  const exits = [...root.querySelectorAll<HTMLElement>('[data-exit]')];
  exits.forEach((el, i) => {
    const o = getComputedStyle(el).opacity;
    el.animate(WORD_EXITS[v.words](o), {
      duration: 340,
      delay: Math.min(i * 30, 180),
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'forwards',
    });
  });

  const dim = Number(v.dim) / 100;
  const blurPx = v.blur === 'heavy' ? 16 : v.blur === 'none' ? 0 : v.blur === 'soft' ? 6 : 12;
  const tileFilter = getComputedStyle(survivor).filter;
  const lateFilter = `blur(${blurPx}px) brightness(${(1 - dim * 0.7).toFixed(2)})`;
  // Inside something that is leaving now (the phone), or the gallery keeps
  // moving: lift it out straight away so it stays put.
  // The lighter tier (tier.ts) lifts it out at once too: whole strips leave around it.
  const light = root.dataset.tier === 'phone';
  const liftNow = v.motion === 'flow' || survivor.closest('[data-exit]') !== null || light;
  // On a strip, it's lifted out at the press too (or on the lighter tier),
  // so the rest of the gallery can fade independently (fading the gallery
  // would fade it with them), gliding to a stop with its strip. It comes
  // out from under the shade and blur as they were over it (coverAt), and
  // clears on its own; the shade stays over the rest until it has nearly
  // faded, so nothing else brightens. (Elsewhere it waits until its gallery
  // has stopped, and the shade lifts as before.)
  const survivorStrip = survivor.parentElement?.closest<HTMLElement>('.lt-row, .lt-col') ?? null;
  const front = survivor.closest('.lt-front') !== null;
  const atPress = !deskFeed && !front && (light || survivorStrip !== null);
  const cover = atPress ? coverAt(root, center(survivor.getBoundingClientRect())) : null;
  // On the lighter tier, no blur: animating one off a layer growing to the
  // whole screen repaints it every frame.
  const coveredFilter = cover
    ? `${!light && cover.blur > 0.3 ? `blur(${cover.blur.toFixed(1)}px) ` : ''}brightness(${(1 - cover.alpha).toFixed(3)})`
    : '';
  let lifted: Lifted | null = atPress ? lift(root, survivor, coveredFilter) : liftNow ? lift(root, survivor, front ? 'none' : lateFilter) : null;
  const glide = survivorStrip ? glides.get(survivorStrip) : undefined;
  const gliding =
    !deskFeed && lifted && glide
      ? lifted.layer.animate([{ translate: '0px 0px' }, { translate: `${glide.x}px ${glide.y}px` }], {
          duration: glide.ms,
          easing: GLIDE_EASING,
          fill: 'forwards',
        })
      : null;
  // In step with its strip's glide, which started at the press.
  if (gliding) gliding.startTime = document.timeline.currentTime;
  // It clears as the others go (`focus`), or as it grows.
  const focusing =
    lifted && atPress && v.focus !== 'late'
      ? lifted.layer.animate([{ filter: coveredFilter }, { filter: tileFilter }], {
          duration: v.focus === 'early' ? (light ? 900 : 450) : pace,
          delay: v.focus === 'early' ? 100 : 140,
          easing: 'cubic-bezier(.4,0,.2,1)',
          fill: 'both',
        })
      : null;

  // ---- Brightness has its own timeline, starting with the picked card's
  // growth. Individual displacement keeps its original schedule below.
  // The shade lifts over the fade's tail, compensated so the wall never brightens.
  const overlays = [...root.querySelectorAll<HTMLElement>('.lt-veil, .lt-blur')];
  const fade: { run: Animation | null; shades: Animation[]; start: number } = { run: null, shades: [], start: 0 };
  const fadeRest = () => {
    if (fade.run || !galleryEl) return;
    fade.start = performance.now();
    const from = Number(getComputedStyle(galleryEl).opacity);
    const ms = FADE[v.fade];
    if (!atPress) {
      fade.run = galleryEl.animate([{ opacity: from }, { opacity: 0 }], { duration: ms, easing: FADE_EASING, fill: 'forwards' });
      return;
    }
    const steps = fadeSteps();
    fade.run = galleryEl.animate(
      steps.map((x) => ({ offset: x.at, opacity: from * x.wall })),
      { duration: ms, fill: 'forwards' },
    );
    fade.shades = overlays.map((el) =>
      el.animate(steps.map((x) => ({ offset: x.at, opacity: x.shade })), { duration: ms, fill: 'forwards' }),
    );
  };

  const hastenFade = () => {
    const runs = [fade.run, ...fade.shades].filter((run): run is Animation => run !== null);
    const start = performance.now();
    const ramp = () => {
      if (!alive()) return;
      const t = Math.min(1, (performance.now() - start) / FADE_ACCELERATE_MS);
      const smooth = t * t * (3 - 2 * t);
      const rate = 1 + (FADE_FINAL_RATE - 1) * smooth;
      // Preserve each animation's current position. Only wall/shade opacity
      // is retimed; no tile, strip or picked-card movement is touched.
      const running = runs.filter((run) => run.playState === 'running');
      running.forEach((run) => run.updatePlaybackRate(rate));
      if (t < 1 && running.length) requestAnimationFrame(ramp);
    };
    requestAnimationFrame(ramp);
  };

  const pending = new Set<number>();
  const later = (ms: number, go: () => void) => {
    const id = window.setTimeout(() => {
      pending.delete(id);
      go();
    }, ms);
    pending.add(id);
  };

  // ---- The others leave, one by one.
  const others = tiles.filter((t) => t.el !== survivor);
  const shown = others.filter((t) => t.seen > 0);
  others.filter((t) => t.seen === 0).forEach((t) => {
    t.el.style.opacity = '0';
    release?.hide(t.el);
  });
  const origin = center(survivor.getBoundingClientRect());
  // The lighter tier keeps no 3D context for the launch (Safari redrew the
  // whole plane when it got one, a pop): there a tile sinks back along the
  // plane's normal drawn flat (sinkOnPlane), which looks the same.
  const plane = survivor.closest<HTMLElement>('[data-plane]');
  const eye = light && plane ? eyeOnPlane(plane) : null;
  const order = turns(shown, v.order, origin);
  const desktopExits: Promise<void>[] = [];
  shown.forEach((t, i) => {
    // At its turn it gets its own canvas and starts to go, in one step.
    const leave = async () => {
      if (!alive()) return;
      release?.detach(t.el);
      const cs = getComputedStyle(t.el);
      const deep = !light && t.el.closest('.lt-tilted') !== null;
      const sunk = eye && t.el.closest('[data-plane]') === plane ? sinkOnPlane(t.el, eye, SINK_DEPTH[v.depth]) : null;
      if (sunk) t.el.style.transformOrigin = sunk.origin;
      const exitFrames = vanish.frames(cs.opacity, cs.filter, deep, sunk?.scale);
      // Restore c901688's per-card exit/fade on desktop. Phones retain their
      // independent wall fade and existing displacement schedule.
      const leaving = t.el.animate(deskFeed ? exitFrames : exitFrames.map(({ opacity: _opacity, ...frame }) => frame), {
        duration: vanish.ms,
        easing: vanish.easing,
        fill: 'forwards',
      });
      if (deskFeed) await leaving.finished.then(() => release?.freeze(t.el), () => {});
    };
    const delay = 140 + order[i] * spread;
    // Include departures that haven't started yet, not just running animations.
    if (deskFeed) desktopExits.push(wait(delay).then(leave));
    else later(delay, () => { void leave(); });
  });

  // ---- The shade and blur lift off, now or as the others go.
  const clearOverlays = (ms: number, delay = 0) =>
    overlays.forEach((el) =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay, easing: deskFeed ? 'linear' : 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
    );
  if (atPress) {
    // The shade goes with the fade (fadeRest).
  } else if (v.focus === 'early' || liftNow) clearOverlays(!deskFeed && light ? 900 : 450, 100);
  else if (v.focus === 'gradual') clearOverlays(pace, 140);

  // ---- A little before the growth (not in its first frame), no more of the
  // others start to leave (each would be a new canvas and animation while it
  // grows); the ones not yet gone stay as they are, fading with the rest.
  const settle = () => {
    pending.forEach((id) => window.clearTimeout(id));
    pending.clear();
  };

  const beatMs = v.beat === 'none' ? 120 : v.beat === 'label' ? 760 : 560;
  if (deskFeed) {
    // Start 500 ms ahead of c901688's exit-based timing. The UI still follows
    // growth completion, shifting it earlier by the same amount.
    const exitWait = long ? 140 + spread * 0.7 + vanish.ms * 0.45 : 140 + spread + vanish.ms;
    await wait(Math.max(0, exitWait - 500));
  } else {
    const startIn = Math.max(0, startMs - 290);
    await wait(Math.max(0, startIn - SETTLE_LEAD));
    if (!alive()) return;
    settle();
    await wait(Math.min(SETTLE_LEAD, startIn));
  }
  if (!alive()) return;

  // ---- Alone, a beat. Lifted out first (once the gallery has stopped), so
  // the beat plays on what grows.
  if (v.motion === 'decelerate') await wait(Math.max(0, 650 - (140 + spread + vanish.ms)));
  if (!alive()) return;
  if (!lifted) lifted = lift(root, survivor, v.focus === 'late' ? lateFilter : tileFilter);
  const beatOn = lifted.layer;
  let beatEl: HTMLElement | null = null;
  const sharpening = sharpen(lifted, hi, deskFeed ? 180 : 360);
  if (v.beat === 'brackets' || v.beat === 'label') {
    const r = beatOn.getBoundingClientRect();
    beatEl = document.createElement('div');
    beatEl.className = v.beat === 'brackets' ? 'lt-beat-box' : 'lt-beat-label';
    if (v.beat === 'label') {
      beatEl.textContent = 'Real or AI?';
      // Under the tile, or over its foot when there is no room below.
      const top = r.bottom + 52 < innerHeight ? r.bottom + 14 : r.bottom - 52;
      Object.assign(beatEl.style, { left: `${r.left + r.width / 2}px`, top: `${top}px` });
    } else {
      Object.assign(beatEl.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }
    root.append(beatEl);
    beatEl.animate(
      v.beat === 'brackets'
        ? [
            { opacity: 0, scale: '1.18' },
            { opacity: 1, scale: '1' },
          ]
        : [
            { opacity: 0, translate: '0 8px' },
            { opacity: 1, translate: '0 0' },
          ],
      { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    );
  } else if (v.beat === 'pulse') {
    beatOn.animate([{ scale: '1' }, { scale: '1.07' }, { scale: '1' }], { duration: beatMs, easing: 'ease-in-out' });
  }
  // The full clip fades in over it whenever it's ready; the growth doesn't wait.
  await Promise.all([wait(beatMs), deskFeed ? sharpening : Promise.race([sharpening, wait(250)])]);
  if (!alive() || !lifted) return;
  const L: Lifted = lifted;


  // ---- It grows onto the feed's video (on a phone, the whole screen).
  if (deskFeed) await until(() => feedStage(clip) !== null, 1200);
  const stage = deskFeed ? feedStage(clip) : null;
  const target: Rect = stage?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const targetRadius = stage ? getComputedStyle(stage).borderTopLeftRadius : '0px';
  const end: Keyframe = {
    left: `${target.left - L.frameRect.left}px`,
    top: `${target.top - L.frameRect.top}px`,
    width: `${target.width}px`,
    height: `${target.height}px`,
    borderRadius: targetRadius,
    clipPath: 'inset(0px 0px 0px 0px)',
    filter: 'none',
  };
  // On a phone, an ease in and out: a fast-starting curve (the spring) loses
  // its first frames whenever the phone is busy as it begins, and leaps.
  const grow = {
    ms: GROW[v.grow].ms * (deskFeed ? 1 : GROWTH[v.growth]),
    easing: !deskFeed && light && v.grow !== 'lift' ? 'cubic-bezier(.45,.05,.2,1)' : GROW[v.grow].easing,
  };
  let frames: Keyframe[] = [L.start, end];
  let frameFrames: Keyframe[] = [{ transform: L.planeTransform }, { transform: L.flatTransform }];
  if (v.grow === 'lift') {
    // First to the middle of the screen, a little bigger; then out.
    const s = L.start as Record<string, string>;
    const w = Math.min(parseFloat(s.width) * 1.25, innerWidth * 0.6);
    const h = (w / parseFloat(s.width)) * parseFloat(s.height);
    const mid: Keyframe = {
      offset: 0.42,
      easing: 'cubic-bezier(.6,0,.15,1)',
      left: `${(innerWidth - w) / 2 - L.frameRect.left}px`,
      top: `${(innerHeight - h) / 2 - L.frameRect.top}px`,
      width: `${w}px`,
      height: `${h}px`,
      borderRadius: s.borderRadius,
      clipPath: 'inset(0px 0px 0px 0px)',
      filter: 'none',
    };
    frames = [{ ...L.start, easing: 'cubic-bezier(.3,0,.2,1)' }, mid, end];
    frameFrames = [{ transform: L.planeTransform }, { offset: 0.42, transform: L.flatTransform }, { transform: L.flatTransform }];
  }
  // It stops gliding with its strip as it starts to grow (by now barely moving).
  const moved = gliding ? getComputedStyle(L.layer).translate : 'none';
  const [slidX = 0, slidY = 0] = moved === 'none' ? [] : moved.split(' ').map(parseFloat);
  const slid = { m41: slidX, m42: slidY };
  gliding?.cancel();
  // On the compositor where it can be: laid out once at its full size and
  // scaled from where it is, then only its transform and clip animate, so a
  // busy main thread can't hold the growth back (moving its box and size
  // every frame ran it at ~24 fps on a Mac, and leapt on an iPhone).
  const aspect = hi.videoWidth && hi.videoHeight ? hi.videoWidth / hi.videoHeight : 9 / 16;
  frames = growOnCompositor(L, frames, target, targetRadius, aspect, { x: slid.m41, y: slid.m42 });
  // Still clearing on its own: the growth leaves its filter alone.
  if (focusing) frames = frames.map(({ filter: _f, ...k }) => k);
  beatEl?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  if (v.focus === 'late' && !liftNow && !atPress) clearOverlays(grow.ms * 0.6);

  // Sound fades in with the growth: the press counts as the user's gesture.
  if (v.sound === 'fade') {
    hi.muted = false;
    hi.volume = 0;
    const t0 = performance.now();
    const up = () => {
      const t = Math.min(1, (performance.now() - t0) / grow.ms);
      hi.volume = t;
      if (t < 1 && alive()) requestAnimationFrame(up);
    };
    requestAnimationFrame(up);
  }

  // Two frames for the moves above to settle, so the growth's first frame is shown, not skipped.
  await nextFrame();
  await nextFrame();
  if (!alive()) return;
  const timing = { duration: grow.ms, easing: grow.easing, fill: 'forwards' as const };
  // The move on its own, so nothing that can't run on the compositor (the
  // clip, a filter) holds it to the main thread; those follow in step.
  const only = (keep: (p: string) => boolean) =>
    frames.map((k) => Object.fromEntries(Object.entries(k).filter(([p]) => p === 'offset' || p === 'easing' || keep(p))) as Keyframe);
  if (!deskFeed) fadeRest();
  const growing = L.layer.animate(only((p) => p === 'transform'), timing);
  L.layer.animate(only((p) => p !== 'transform'), timing);
  L.frame.animate(frameFrames, timing);

  const phone: { video: HTMLVideoElement | null } = { video: null };
  const feedVideo = stage?.querySelector('video') ?? null;
  // The feed's own video takes the same moment, just before the growth ends.
  await wait(Math.max(0, grow.ms - 260));
  if (feedVideo) feedVideo.currentTime = Math.min(hi.currentTime + 0.26, (hi.duration || 8) - 0.05);
  await growing.finished.catch(() => {});
  if (!alive()) return;
  if (feedVideo && Math.abs(feedVideo.currentTime - hi.currentTime) > 0.15) feedVideo.currentTime = hi.currentTime;
  if (!deskFeed) {
    hooks.mountApp(clip);
    await nextFrame();
    await until(() => {
      phone.video = phoneFeedVideo(root);
      return !!phone.video && phone.video.readyState >= 1;
    }, 2500);
    if (!alive()) return;
  }
  // Desktop returns to c901688's handoff immediately after growth. Phones
  // retain their existing fade-relative wait and smooth fade acceleration.
  if (!deskFeed) {
    const arriveIn = fade.start + Math.max(0, FADE[v.fade] * ARRIVE_THROUGH - ARRIVE_LEAD_MS) - performance.now();
    if (arriveIn > 0) await wait(arriveIn);
    if (!alive()) return;
  }
  root.style.pointerEvents = 'none';
  arriveChrome(v.arrive);
  if (!deskFeed) hastenFade();
  await root.animate([{ backgroundColor: getComputedStyle(root).backgroundColor }, { backgroundColor: 'transparent' }], {
    duration: 260,
    fill: 'forwards',
  }).finished.catch(() => {});
  if (!alive()) return;
  // On a phone the feed's video waits (paused) until the landing has gone, so it
  // is brought to this moment now: it would start from the top, and the swap
  // showed a different frame of the clip.
  const pv = phone.video;
  if (pv && hi.readyState >= 2) {
    pv.currentTime = Math.min(hi.currentTime + 0.16, (pv.duration || 8) - 0.05);
    await Promise.race([new Promise((r) => pv.addEventListener('seeked', r, { once: true })), wait(300)]);
    if (!alive()) return;
  }
  sendHandoff({ muted: v.sound === 'muted' });
  hi.muted = true;
  await L.frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished;
  // The feed is already visible and interactive. Keep the transparent landing
  // layer until every remaining card has faded, even with an earlier handoff.
  if (deskFeed) await Promise.all(desktopExits);
  else await fade.run?.finished.catch(() => {});
  if (alive()) hooks.done();
}
