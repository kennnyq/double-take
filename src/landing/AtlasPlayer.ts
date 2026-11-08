import { atlasMode, cellRect, clipTime, planBoard, type Atlas, type AtlasMode, type BoardPlan, type PlacedTile } from './atlas';
import { streamLoop } from './atlasStream';
import { nextGap, pickSwipe, snap, SWIPE_MS, swipeSlices, type ReelPace, type ReelTile } from './reels';

/**
 * Draws the gallery atlas onto "boards": one canvas under each strip of tiles
 * that moves together (a row, a column, the mosaic's plane), or inside a
 * tile that moves on its own (orbit, tunnel, the phone). Every visible tile
 * plays, from one video and one decoder, and a board is redrawn only when the
 * atlas has a new frame (15 fps), while the strips themselves keep scrolling
 * on the compositor with their CSS animations.
 *
 * Measured on Tilted plane (1440x900, DPR 2, integrated GPU), 68 tiles on
 * screen: a <video> per tile ran at 6 fps; a canvas per tile at 43 fps;
 * one canvas per row at 58 fps, next to 60 fps for still posters.
 *
 * It never breaks its loop: the atlas plays as one endless Media Source
 * timeline (`atlasStream.ts`), each cell's loop closes on an eased dissolve
 * at its own moment (`build_atlas.py`), a strip's halves are drawn exactly a
 * half apart so the scroll wraps without a shift, and tiles show the atlas's
 * first frame (which the video then starts from) until it plays.
 *
 * Now and then one tile "scrolls to the next reel" (`reels.ts`): its clip
 * slides up and out as another slides in from below, cut from the same atlas,
 * so it costs no decoder. Boards redraw every frame only while one moves.
 */

/** A tile part way through a swipe, from one cell to another. */
interface Swipe {
  from: number;
  to: number;
  start: number;
}

interface Board {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  plan: BoardPlan;
  /**
   * For boards of several tiles: just the bits outside each tile's rounded
   * corners, erased after every frame. (Clipping to a path of rounded rects
   * instead cost 30x: 2 fps against 58 on Tilted plane.)
   */
  corners: HTMLCanvasElement | null;
  /** Inside the one tile it draws, rather than under a strip of them. */
  own: boolean;
  tiles: HTMLElement[];
  /**
   * The gallery it's in, which must be on screen too: a plane tilted in 3D
   * can project far beyond what it shows, and its rows then never leave.
   */
  gate: Element | null;
  /** Left on its last frame (the launch's leaving tiles). */
  frozen: boolean;
  /** Each tile's cell now: swipes change them. */
  cells: number[];
  swipes: (Swipe | undefined)[];
  /** Each tile's key for swiping: a strip's two copies of a tile share one, and swipe together. */
  keys: string[];
}

let boardIds = 0;

/** Waits for the page to have loaded and gone idle, so the atlas never competes with the hero. */
function afterLoad(fn: () => void) {
  const idle = () =>
    typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200);
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

function visitorMode(): AtlasMode {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return atlasMode({
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: c?.saveData,
    effectiveType: c?.effectiveType,
  });
}

/** The tiles' color while nothing is drawn yet, so they read as tiles, not holes. */
const EMPTY = '#15161a';

/**
 * Where `tiles` sit in `container`, to the fraction of a pixel. Offsets are
 * whole pixels, and a tilted plane's projected boxes aren't flat, so the
 * transforms from the container up to the gallery are lifted for a moment.
 */
function measureFlat(container: HTMLElement, tiles: HTMLElement[]) {
  const lifted: [HTMLElement, string, string][] = [];
  for (let el: HTMLElement | null = container; el && !el.classList.contains('lt-gallery'); el = el.parentElement) {
    lifted.push([el, el.style.getPropertyValue('transform'), el.style.getPropertyPriority('transform')]);
    el.style.setProperty('transform', 'none', 'important');
    if (el === document.body) break;
  }
  const base = container.getBoundingClientRect();
  const rects = tiles.map((t) => t.getBoundingClientRect());
  for (const [el, value, priority] of lifted) {
    if (value) el.style.setProperty('transform', value, priority);
    else el.style.removeProperty('transform');
  }
  return {
    w: Math.max(base.width, container.scrollWidth),
    h: Math.max(base.height, container.scrollHeight),
    tiles: rects.map((r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height })),
  };
}

/** What lies outside each tile's rounded corners, inside its box. Null when the tiles are square. */
function cornerMask(plan: BoardPlan, tiles: HTMLElement[]): HTMLCanvasElement | null {
  const radii = tiles.map((t) => (parseFloat(getComputedStyle(t).borderTopLeftRadius) || 0) * plan.scale);
  if (radii.every((r) => r < 0.5)) return null;
  const mask = document.createElement('canvas');
  mask.width = plan.width;
  mask.height = plan.height;
  const g = mask.getContext('2d');
  if (!g) return null;
  plan.draws.forEach((d) => g.fillRect(d.dx, d.dy, d.dw, d.dh));
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  plan.draws.forEach((d, i) => g.roundRect(d.dx, d.dy, d.dw, d.dh, radii[i]));
  g.fill();
  return mask;
}

export class AtlasPlayer {
  readonly mode: AtlasMode;
  private video: HTMLVideoElement | null = null;
  private still: HTMLImageElement | null = null;
  private boards = new Set<Board>();
  private visible = new Set<Board>();
  /** Observed elements (canvases and gates) that are on screen. */
  private seen = new Set<Element>();
  private gates = new Map<Element, number>();
  private io: IntersectionObserver;
  private frameRequested = false;
  private wantVideo = false;
  /** How often tiles swipe; null for never. */
  private pace: ReelPace | null = null;
  private reelTimer = 0;
  /** When each tile key last swiped (or, first seen, a made-up past so they don't all go at once). */
  private lastSwipe = new Map<string, number>();
  /** Swipes stop for the launch. */
  private held = false;
  private swiping = new Set<Board>();
  private swipeFrame = 0;
  /** The feed index of the clip in each cell, for the tile's `data-clip`. */
  private clipOfCell = new Map<number, number>();

  constructor(readonly atlas: Atlas) {
    this.mode = visitorMode();
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this.seen.add(e.target);
          else this.seen.delete(e.target);
        }
        this.refresh();
      },
      { rootMargin: '120px' },
    );
    if (atlas.posterUrl) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => this.drawAll();
      img.src = atlas.posterUrl;
      this.still = img;
    }
    document.addEventListener('visibilitychange', this.update);
    if (this.mode === 'play') afterLoad(() => this.load());
  }

  /**
   * Fetches the whole atlas first (about 2 MB), so it never stalls mid-loop
   * waiting on the network; until then tiles show its first frame.
   */
  private async load() {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const res = await fetch(this.atlas.srcUrl);
      if (!res.ok) return;
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      return;
    }
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto' });
    v.setAttribute('aria-hidden', 'true');
    // Kept in the document (Safari won't play it detached) but out of sight.
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    v.addEventListener('loadeddata', () => this.drawAll(), { once: true });
    const { mime, loop } = this.atlas;
    if (!mime || !streamLoop(v, bytes, mime, loop)) {
      v.loop = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    }
    document.body.append(v);
    this.video = v;
    this.update();
  }

  private refresh() {
    for (const b of this.boards) {
      const show = !b.frozen && this.seen.has(b.canvas) && (!b.gate || this.seen.has(b.gate));
      if (show && !this.visible.has(b)) {
        this.visible.add(b);
        this.draw(b);
      } else if (!show) this.visible.delete(b);
    }
    this.update();
  }

  /** Play while a board is on screen and the tab is in view; pause otherwise. */
  private update = () => {
    const v = this.video;
    if (!v) return;
    const want = this.visible.size > 0 && !document.hidden;
    if (want === this.wantVideo) return;
    this.wantVideo = want;
    if (want) {
      v.play().catch(() => {});
      this.request();
    } else v.pause();
  };

  private request() {
    const v = this.video;
    if (!v || this.frameRequested) return;
    this.frameRequested = true;
    const next = () => {
      this.frameRequested = false;
      if (!this.wantVideo) return;
      this.visible.forEach((b) => this.draw(b));
      this.request();
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  }

  private source(): CanvasImageSource | null {
    if (this.video && this.video.readyState >= 2) return this.video;
    if (this.still?.complete && this.still.naturalWidth) return this.still;
    return null;
  }

  private draw(b: Board, now = performance.now()) {
    const src = this.source();
    const { ctx, plan, corners } = b;
    if (src) {
      plan.draws.forEach((d, i) => {
        const at = (cell: number) => {
          const c = cellRect(this.atlas, cell);
          return { sx: c.sx + d.ox, sy: c.sy + d.oy };
        };
        const swipe = b.swipes[i];
        if (swipe) {
          const t = (now - swipe.start) / SWIPE_MS;
          if (t < 1) {
            for (const x of swipeSlices(snap(t), d, at(swipe.from), at(swipe.to)))
              ctx.drawImage(src, x.sx, x.sy, x.sw, x.sh, x.dx, x.dy, x.dw, x.dh);
            return;
          }
          b.swipes[i] = undefined;
        }
        const { sx, sy } = at(b.cells[i]);
        ctx.drawImage(src, sx, sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      });
    } else {
      ctx.fillStyle = EMPTY;
      for (const d of plan.draws) ctx.fillRect(d.dx, d.dy, d.dw, d.dh);
    }
    if (corners) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(corners, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawAll() {
    this.boards.forEach((b) => this.draw(b));
  }

  /** How often tiles swipe to another clip (null: never), and which feed clip each cell holds. */
  setReels(pace: ReelPace | null, clipOfCell: Map<number, number>) {
    this.pace = this.mode === 'play' ? pace : null;
    this.clipOfCell = clipOfCell;
    this.held = false;
    this.scheduleReel();
  }

  private scheduleReel() {
    clearTimeout(this.reelTimer);
    if (!this.pace || this.held) return;
    this.reelTimer = window.setTimeout(() => {
      this.reel();
      this.scheduleReel();
    }, nextGap(this.pace) * 1000);
  }

  /** One swipe, somewhere on screen: the tile that has waited longest, to a clip not shown near it. */
  private reel() {
    const pace = this.pace;
    if (!pace || this.held || document.hidden || !this.wantVideo) return;
    const now = performance.now();
    // Every copy of each tile (a strip holds each twice), and where the one on screen is.
    const members = new Map<string, [Board, number][]>();
    const onScreen = new Map<string, ReelTile>();
    const margin = 0.06;
    for (const b of this.visible) {
      if (!b.gate || b.frozen) continue;
      b.tiles.forEach((el, i) => {
        if (el.hasAttribute('data-hero-tile')) return;
        const key = b.keys[i];
        members.set(key, [...(members.get(key) ?? []), [b, i]]);
        if (b.swipes[i]) return;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < innerWidth * margin || x > innerWidth * (1 - margin) || y < innerHeight * margin || y > innerHeight * (1 - margin)) return;
        if (!this.lastSwipe.has(key)) this.lastSwipe.set(key, now - Math.random() * pace.each * 1000);
        onScreen.set(key, { key, x, y, size: Math.max(r.width, r.height), cell: b.cells[i], last: this.lastSwipe.get(key)! });
      });
    }
    const tiles = [...onScreen.values()];
    const pick = pickSwipe(tiles, this.atlas.ids.length, now, pace);
    if (!pick) return;
    this.lastSwipe.set(pick.key, now);
    for (const [b, i] of members.get(pick.key)!) {
      b.swipes[i] = { from: b.cells[i], to: pick.cell, start: now };
      b.cells[i] = pick.cell;
      // A press on it now opens the feed on its new clip.
      const el = b.tiles[i];
      el.dataset.cell = String(pick.cell);
      const clip = this.clipOfCell.get(pick.cell);
      if (clip !== undefined) el.dataset.clip = String(clip);
      this.swiping.add(b);
    }
    this.animateSwipes();
  }

  /** Redraws boards with a tile mid-swipe every frame, until the swipes settle. */
  private animateSwipes() {
    if (this.swipeFrame) return;
    const step = () => {
      const now = performance.now();
      for (const b of this.swiping) {
        this.draw(b, now);
        if (!b.swipes.some(Boolean)) this.swiping.delete(b);
      }
      this.swipeFrame = this.swiping.size ? requestAnimationFrame(step) : 0;
    };
    this.swipeFrame = requestAnimationFrame(step);
  }

  /** The moment in its clip the tile in `cell` shows now. */
  clipTime(cell: number): number {
    return clipTime(this.atlas, this.video?.currentTime ?? 0, cell);
  }

  /**
   * A board for `tiles`, all of which move with `container` (or are it). Its
   * canvas goes underneath them, so whatever sits on a tile stays on top.
   */
  addBoard(container: HTMLElement, tiles: HTMLElement[]): Board | null {
    const own = tiles.length === 1 && tiles[0] === container;
    const box = own
      ? { w: container.offsetWidth, h: container.offsetHeight, tiles: [{ x: 0, y: 0, w: container.offsetWidth, h: container.offsetHeight }] }
      : measureFlat(container, tiles);
    const placed: PlacedTile[] = tiles.map((t, i) => ({ cell: Number(t.dataset.cell), ...box.tiles[i] }));
    const plan = planBoard(this.atlas, box.w, box.h, placed);
    const ctx0 = plan && document.createElement('canvas').getContext('2d');
    if (!plan || !ctx0) return null;
    const canvas = ctx0.canvas;
    canvas.width = plan.width;
    canvas.height = plan.height;
    canvas.className = 'lt-board';
    canvas.setAttribute('aria-hidden', 'true');
    // A tile's own board fills it, so it grows with the tile at the launch. A
    // strip's is sized from its canvas, so canvas and CSS pixels keep one ratio.
    Object.assign(
      canvas.style,
      own ? { width: '100%', height: '100%' } : { width: `${plan.width / plan.scale}px`, height: `${plan.height / plan.scale}px` },
    );
    const corners = own ? null : cornerMask(plan, tiles);
    const gate = container.closest('.lt-gallery');
    const id = ++boardIds;
    const board: Board = {
      canvas,
      ctx: ctx0,
      plan,
      corners,
      own,
      tiles,
      gate,
      frozen: false,
      cells: placed.map((t) => t.cell),
      swipes: tiles.map(() => undefined),
      keys: tiles.map((t, i) => `${id}:${t.dataset.twin ?? i}`),
    };
    container.prepend(canvas);
    tiles.forEach((t) => t.setAttribute('data-on-board', ''));
    this.boards.add(board);
    this.io.observe(canvas);
    if (gate) {
      if (!this.gates.has(gate)) this.io.observe(gate);
      this.gates.set(gate, (this.gates.get(gate) ?? 0) + 1);
    }
    this.draw(board);
    return board;
  }

  /** Takes a board down; `settle` false leaves the video playing, for one about to replace it. */
  removeBoard(b: Board, settle = true) {
    this.io.unobserve(b.canvas);
    this.seen.delete(b.canvas);
    if (b.gate) {
      const n = (this.gates.get(b.gate) ?? 1) - 1;
      if (n > 0) this.gates.set(b.gate, n);
      else {
        this.gates.delete(b.gate);
        this.io.unobserve(b.gate);
        this.seen.delete(b.gate);
      }
    }
    this.boards.delete(b);
    this.visible.delete(b);
    this.swiping.delete(b);
    b.canvas.remove();
    b.tiles.forEach((t) => t.removeAttribute('data-on-board'));
    if (settle) this.update();
  }

  /**
   * Boards under `root`: each `[data-board]` with its tiles, and each other
   * tile on its own. Returns a function that takes them down again.
   */
  mount(root: HTMLElement): () => void {
    const made: Board[] = [];
    const tiles = [...root.querySelectorAll<HTMLElement>('[data-tile][data-cell]')];
    const groups = new Map<HTMLElement, HTMLElement[]>();
    for (const t of tiles) {
      const owner = t.parentElement?.closest<HTMLElement>('[data-board]') ?? t;
      groups.set(owner, [...(groups.get(owner) ?? []), t]);
    }
    groups.forEach((ts, owner) => {
      const b = this.addBoard(owner, ts);
      if (b) made.push(b);
    });
    return () => {
      made.forEach((b) => this.boards.has(b) && this.removeBoard(b));
      this.prune();
    };
  }

  /** Drops boards whose canvas has left the page (a launch's, once the landing is gone). */
  private prune() {
    this.boards.forEach((b) => !b.canvas.isConnected && this.removeBoard(b));
  }

  /**
   * For the launch, which moves and fades tiles one by one: every tile on a
   * shared board that is on screen gets a board of its own, and the shared
   * boards go. Returns a function that leaves one tile on its last frame,
   * for when it has gone, so the redraws dwindle as the tiles leave.
   */
  separate(root: HTMLElement): (tile: HTMLElement) => void {
    this.prune();
    // No swipes while the gallery leaves.
    this.held = true;
    clearTimeout(this.reelTimer);
    const shared = [...this.boards].filter((b) => !b.own && root.contains(b.canvas));
    for (const b of shared) {
      const onScreen = b.tiles.filter((t) => {
        const r = t.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      });
      this.removeBoard(b, false);
      onScreen.forEach((t) => this.addBoard(t, [t]));
    }
    return (tile) => {
      for (const b of this.boards) {
        if (!b.own || b.tiles[0] !== tile) continue;
        // Stays on the page as it is (the landing's unmounting takes it down), no longer redrawn.
        b.frozen = true;
        this.visible.delete(b);
      }
      this.update();
    };
  }
}

let shared: AtlasPlayer | null = null;

/** The page's one player for `atlas`. */
export function atlasPlayer(atlas: Atlas): AtlasPlayer {
  if (shared?.atlas.srcUrl !== atlas.srcUrl) shared = new AtlasPlayer(atlas);
  return shared;
}

/** The player drawing `root`'s tiles, if any. */
export function playerFor(root: HTMLElement): AtlasPlayer | null {
  return shared && root.querySelector('.lt-board') ? shared : null;
}
