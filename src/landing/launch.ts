import { playerFor } from './AtlasPlayer';
import type { LandingValues } from './designs';
import { neverFaster } from './ease';
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
    easing: 'cubic-bezier(.5,0,.9,.5)',
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
 * The full clip, at the small one's moment, faded in over it. It was started
 * at the press (`warm`), so here it only moves in: seeking and starting a
 * video as the growth began stalled Safari, and the growth's first frames
 * were lost (it leapt).
 */
async function sharpen(lifted: Lifted, hi: HTMLVideoElement) {
  await until(() => hi.readyState >= 2, 600);
  if (hi.paused) {
    hi.currentTime = Math.min(lifted.time() + 0.06, (hi.duration || 8) - 0.05);
    await Promise.race([new Promise((r) => hi.addEventListener('seeked', r, { once: true })), wait(300)]);
  }
  hi.style.cssText = '';
  // Moved in the same task, it keeps playing.
  lifted.layer.append(hi);
  hi.play().catch(() => {});
  hi.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-in-out', fill: 'forwards' });
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

/** Setting up the growth (the beat, the full clip's first frames) takes about this long (ms), so it waits that much less. */
const GROW_SETUP = 290;
/** No more of the others start to leave from this long before the growth starts (ms), so the two don't share a frame. */
const SETTLE_LEAD = 250;
/** How long it grows, against the grow style's own length (a design on trial: `growth`). */
const GROWTH: Record<LandingValues['growth'], number> = { fast: 1, medium: 1.25, slow: 1.6 };
/** How long after that the rest of the gallery fades out (ms; a design on trial: `fade`). */
const FADE_AFTER: Record<LandingValues['fade'], number> = { early: 0, later: 1000, late: 2000 };
/** How long that fade takes (ms). */
const FADE_MS = 600;

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
function glideToStop(strip: HTMLElement, run: Animation, stop: { ms: number }): boolean {
  const timing = run.effect?.getTiming();
  const period = Number(timing?.duration);
  if (!period || !Number.isFinite(period)) return false;
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
  strip.animate([{ transform: move(from) }, { transform: move(to) }], {
    duration: stop.ms,
    easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
    fill: 'forwards',
  });
  return true;
}

export async function launch(root: HTMLElement, v: LandingValues, from: HTMLElement | null, hooks: LaunchHooks) {
  const alive = () => root.isConnected;
  const fromTile = from?.closest<HTMLElement>('[data-tile]') ?? null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Launched from further down: back to the hero first.
  if (!fromTile && root.scrollTop > 2) {
    root.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    await until(() => root.scrollTop <= 2, 900);
  }
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
  // The app's desktop layout shows the clip in a card the growth aims for, so it
  // mounts now. On a phone the feed fills the screen: the growth needs nothing
  // from it, and the app mounts once it's done, when its first render (heavy on
  // a phone) can't jolt the animation.
  const deskFeed = innerWidth >= 760 && innerHeight >= 480;
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
  const vanish = v.vanish === 'recede' ? recede(v) : VANISH[v.vanish];
  const pace = Number(v.pace);
  const long = vanish.ms >= 1500;
  const spread = Math.max(pace - vanish.ms, long ? vanish.ms * 0.6 : 0);
  const stop = slowdown(v.motion, Math.max(pace, spread + vanish.ms));
  if (stop) {
    // Strips glide to a stop in one animation each, on the compositor: from
    // where they are to where the slowdown would leave them. Changing their
    // playback rate every frame from script instead stalled them whenever the
    // page was busy, and in WebKit cost so much the exit ran at ~1 fps.
    const glided = new Set<Animation>();
    for (const strip of root.querySelectorAll<HTMLElement>('.lt-row, .lt-col')) {
      const run = strip.getAnimations()[0];
      if (run && glideToStop(strip, run, stop)) glided.add(run);
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
  // On the lighter tier, no filter: animating a blur off a layer growing to the
  // whole screen repaints it every frame.
  let lifted: Lifted | null = liftNow
    ? lift(root, survivor, survivor.closest('.lt-front') || light ? 'none' : lateFilter)
    : null;

  // Everything leaving, so the stragglers can be kept from speeding up as the rest fades.
  const leavingAll: Animation[] = [];
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
  shown.forEach((t, i) => {
    // At its turn it gets its own canvas and starts to go, in one step.
    later(140 + order[i] * spread, () => {
      if (!alive()) return;
      release?.detach(t.el);
      const cs = getComputedStyle(t.el);
      const deep = !light && t.el.closest('.lt-tilted') !== null;
      const sunk = eye && t.el.closest('[data-plane]') === plane ? sinkOnPlane(t.el, eye, SINK_DEPTH[v.depth]) : null;
      if (sunk) t.el.style.transformOrigin = sunk.origin;
      const leaving = t.el.animate(vanish.frames(cs.opacity, cs.filter, deep, sunk?.scale), {
        duration: vanish.ms,
        easing: vanish.easing,
        fill: 'forwards',
      });
      leavingAll.push(leaving);
      // Its clip plays on until it has gone.
      void leaving.finished.then(() => release?.freeze(t.el), () => {});
    });
  });

  // ---- The shade and blur lift off, now or as the others go.
  const overlays = [...root.querySelectorAll<HTMLElement>('.lt-veil, .lt-blur')];
  const clearOverlays = (ms: number, delay = 0) =>
    overlays.forEach((el) =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
    );
  if (v.focus === 'early' || liftNow) clearOverlays(light ? 900 : 450, 100);
  else if (v.focus === 'gradual') clearOverlays(pace, 140);

  // ---- A little before the growth (not in its first frame), no more of the
  // others start to leave (each would be a new canvas and animation while it
  // grows); the ones not yet gone stay as they are, coasting.
  const settle = () => {
    pending.forEach((id) => window.clearTimeout(id));
    pending.clear();
  };
  // ---- Then (`fade`) the rest of the gallery (the one that stays is out of
  // it) fades out as a whole, in one animation: its opacity only. Nothing in
  // it speeds up: those still leaving go on as they were, except that any
  // still gathering speed (an exit that eases in) slows from here instead.
  let fading: Animation | null = null;
  let fadeTimer = 0;
  const fadeRest = (): Animation | null => {
    window.clearTimeout(fadeTimer);
    if (fading || !galleryEl || !alive()) return fading;
    for (const a of leavingAll) {
      const effect = a.effect;
      const t = effect?.getComputedTiming();
      if (a.playState !== 'running' || !effect || !t || typeof t.duration !== 'number' || !t.duration) continue;
      const calmer = neverFaster(String(t.easing), Number(t.localTime ?? 0) / t.duration);
      try {
        if (calmer) effect.updateTiming({ easing: calmer });
      } catch {
        // No linear() easing in this browser: it goes on as it was.
      }
    }
    fading = galleryEl.animate([{ opacity: getComputedStyle(galleryEl).opacity }, { opacity: 0 }], {
      duration: FADE_MS,
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'forwards',
    });
    return fading;
  };

  // The one that stays starts forward soon after the press, over the coast and
  // the others leaving (it waited for most to go: ~3 s, which read as late).
  // When is a design on trial (`start`); it was ~3 s (late), then ~0.85 s (too soon).
  const startIn = Math.max(0, Math.min(Number(v.start), 140 + spread + vanish.ms) - GROW_SETUP);
  await wait(Math.max(0, startIn - SETTLE_LEAD));
  if (!alive()) return;
  settle();
  if (FADE_AFTER[v.fade]) fadeTimer = window.setTimeout(fadeRest, FADE_AFTER[v.fade]);
  else fadeRest();
  await wait(Math.min(SETTLE_LEAD, startIn));
  if (!alive()) return;

  // ---- Alone, a beat. Lifted out first (once the gallery has stopped), so
  // the beat plays on what grows.
  if (v.motion === 'decelerate') await wait(Math.max(0, 650 - (140 + spread + vanish.ms)));
  if (!alive()) return;
  if (!lifted) lifted = lift(root, survivor, v.focus === 'late' ? lateFilter : tileFilter);
  const beatOn = lifted.layer;
  let beatEl: HTMLElement | null = null;
  const beatMs = v.beat === 'none' ? 120 : v.beat === 'label' ? 760 : 560;
  const sharpening = sharpen(lifted, hi);
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
  await Promise.all([wait(beatMs), Promise.race([sharpening, wait(250)])]);
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
    ms: GROW[v.grow].ms * GROWTH[v.growth],
    easing: light && v.grow !== 'lift' ? 'cubic-bezier(.45,.05,.2,1)' : GROW[v.grow].easing,
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
  beatEl?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  if (v.focus === 'late' && !liftNow) clearOverlays(grow.ms * 0.6);

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
  const growing = L.layer.animate(frames, timing);
  L.frame.animate(frameFrames, timing);

  // The feed's own video takes the same moment, just before the growth ends.
  const feedVideo = stage?.querySelector('video') ?? null;
  await wait(Math.max(0, grow.ms - 260));
  if (feedVideo) feedVideo.currentTime = Math.min(hi.currentTime + 0.26, (hi.duration || 8) - 0.05);
  await growing.finished.catch(() => {});
  if (!alive()) return;
  if (feedVideo && Math.abs(feedVideo.currentTime - hi.currentTime) > 0.15) feedVideo.currentTime = hi.currentTime;
  const phone: { video: HTMLVideoElement | null } = { video: null };
  if (!deskFeed) {
    // The full-screen clip plays on while the app mounts beneath, until the
    // feed's video for it has loaded.
    hooks.mountApp(clip);
    await nextFrame();
    await until(() => {
      phone.video = phoneFeedVideo(root);
      return !!phone.video && phone.video.readyState >= 1;
    }, 2500);
    if (!alive()) return;
  }

  // ---- Arrive: the page behind goes, the app's pieces come in, the feed's
  // video takes over under the one that grew. The rest of the gallery has
  // faded first (a late fade starts now, if it hasn't yet).
  await fadeRest()?.finished.catch(() => {});
  if (!alive()) return;
  root.style.pointerEvents = 'none';
  arriveChrome(v.arrive);
  await root.animate([{ backgroundColor: getComputedStyle(root).backgroundColor }, { backgroundColor: 'transparent' }], {
    duration: 260,
    fill: 'forwards',
  }).finished;
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
  if (alive()) hooks.done();
}
