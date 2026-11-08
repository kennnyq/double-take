import { playerFor } from './AtlasPlayer';
import type { LandingValues } from './designs';
import { sendHandoff } from './handoff';

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

const VANISH: Record<LandingValues['vanish'], { ms: number; easing: string; frames(o: string, f: string): Keyframe[] }> = {
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
  let origin = '50% 50%';
  let local: Rect;
  if (plane) {
    const cs = getComputedStyle(plane);
    planeTransform = cs.transform;
    origin = cs.transformOrigin;
    // Where the tile sits on the plane, measured flat.
    plane.style.setProperty('transform', 'none', 'important');
    frameRect = plane.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    plane.style.removeProperty('transform');
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
  root.append(f);
  // Moved in the same task, the video keeps playing.
  layer.append(small);
  if (board) layer.append(board);
  else small.play().catch(() => {});
  tile.style.visibility = 'hidden';
  const time = player ? () => player.clipTime() : () => small.currentTime;
  return { frame: f, layer, frameRect, planeTransform, start, small, time };
}

/** The full clip, at the small one's moment, faded in over it. */
async function sharpen(lifted: Lifted, hi: HTMLVideoElement) {
  await until(() => hi.readyState >= 2, 600);
  hi.currentTime = Math.min(lifted.time() + 0.06, (hi.duration || 8) - 0.05);
  await Promise.race([new Promise((r) => hi.addEventListener('seeked', r, { once: true })), wait(300)]);
  hi.play().catch(() => {});
  lifted.layer.append(hi);
  hi.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' });
}

// ---- The launch --------------------------------------------------------

const GROW: Record<LandingValues['grow'], { ms: number; easing: string }> = {
  straight: { ms: 850, easing: 'cubic-bezier(.2,.8,.2,1)' },
  lift: { ms: 1250, easing: 'linear' },
  spring: { ms: 980, easing: 'cubic-bezier(.34,1.32,.64,1)' },
  slow: { ms: 1500, easing: 'cubic-bezier(.65,0,.25,1)' },
};

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
  // Tiles drawn a strip at a time by the atlas get a canvas each, so they can leave one by one.
  const keepOnly = playerFor(root)?.separate(root);

  const galleryEl = root.querySelector<HTMLElement>('.lt-gallery');
  const galleryRect = galleryEl?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  const button = from && !fromTile ? from.getBoundingClientRect() : null;
  const tiles: Measured[] = [...root.querySelectorAll<HTMLElement>('[data-tile]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, r, seen: visibleFraction(r) };
  });
  const survivor = fromTile ?? pickSurvivor(tiles, v.pick, button, galleryRect);
  keepOnly?.(survivor);
  const clip = Number(survivor.dataset.clip) || 0;
  hooks.mountApp(clip);

  const hi = document.createElement('video');
  Object.assign(hi, { src: hooks.fullSrc(clip) ?? '', muted: true, loop: true, playsInline: true, preload: 'auto' });
  hi.className = 'lt-hi';
  hi.load();

  if (reduce) {
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
  if (v.motion === 'decelerate') {
    const t0 = performance.now();
    const slow = () => {
      const t = Math.min(1, (performance.now() - t0) / 650);
      const rate = (1 - t) ** 2;
      moving.forEach((a) => (t >= 1 ? a.pause() : a.updatePlaybackRate(rate)));
      if (t < 1 && alive()) requestAnimationFrame(slow);
    };
    requestAnimationFrame(slow);
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
  const liftNow = v.motion === 'flow' || survivor.closest('[data-exit]') !== null;
  let lifted: Lifted | null = liftNow ? lift(root, survivor, survivor.closest('.lt-front') ? 'none' : lateFilter) : null;

  // ---- The others leave, one by one.
  const vanish = VANISH[v.vanish];
  const pace = Number(v.pace);
  const spread = Math.max(0, pace - vanish.ms);
  const others = tiles.filter((t) => t.el !== survivor);
  const shown = others.filter((t) => t.seen > 0);
  others.filter((t) => t.seen === 0).forEach((t) => (t.el.style.opacity = '0'));
  const origin = center(survivor.getBoundingClientRect());
  const order = turns(shown, v.order, origin);
  shown.forEach((t, i) => {
    const cs = getComputedStyle(t.el);
    t.el.animate(vanish.frames(cs.opacity, cs.filter), {
      delay: 140 + order[i] * spread,
      duration: vanish.ms,
      easing: vanish.easing,
      fill: 'both',
    });
  });

  // ---- The shade and blur lift off, now or as the others go.
  const overlays = [...root.querySelectorAll<HTMLElement>('.lt-veil, .lt-blur')];
  const clearOverlays = (ms: number, delay = 0) =>
    overlays.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay, fill: 'forwards' }));
  if (v.focus === 'early' || liftNow) clearOverlays(450, 100);
  else if (v.focus === 'gradual') clearOverlays(pace, 140);

  await wait(140 + spread + vanish.ms);
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
  await Promise.all([wait(beatMs), sharpening]);
  if (!alive() || !lifted) return;
  const L: Lifted = lifted;

  // ---- It grows onto the feed's video.
  await until(() => feedStage(clip) !== null, 1200);
  const stage = feedStage(clip);
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
  const grow = GROW[v.grow];
  let frames: Keyframe[] = [L.start, end];
  let frameFrames: Keyframe[] = [{ transform: L.planeTransform }, { transform: 'none' }];
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
    frameFrames = [{ transform: L.planeTransform }, { offset: 0.42, transform: 'none' }, { transform: 'none' }];
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

  // ---- Arrive: the page behind goes, the app's pieces come in, the feed's
  // video takes over under the one that grew.
  root.style.pointerEvents = 'none';
  arriveChrome(v.arrive);
  await root.animate([{ backgroundColor: getComputedStyle(root).backgroundColor }, { backgroundColor: 'transparent' }], {
    duration: 260,
    fill: 'forwards',
  }).finished;
  if (!alive()) return;
  sendHandoff({ muted: v.sound === 'muted' });
  hi.muted = true;
  await L.frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished;
  if (alive()) hooks.done();
}
