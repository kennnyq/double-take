import { atlasMode, clipTime, planBoard, type Atlas, type AtlasMode, type BoardPlan, type PlacedTile } from './atlas';

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
 */

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
}

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

  private load() {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: this.atlas.srcUrl });
    v.setAttribute('aria-hidden', 'true');
    // Kept in the document (Safari won't play it detached) but out of sight.
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    v.addEventListener('loadeddata', () => this.drawAll(), { once: true });
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

  private draw(b: Board) {
    const src = this.source();
    if (!src) return;
    const { ctx, plan, corners } = b;
    for (const d of plan.draws) ctx.drawImage(src, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    if (corners) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(corners, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawAll() {
    this.boards.forEach((b) => this.draw(b));
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
    const placed: PlacedTile[] = tiles.map((t) =>
      own
        ? { cell: Number(t.dataset.cell), x: 0, y: 0, w: t.offsetWidth, h: t.offsetHeight }
        : { cell: Number(t.dataset.cell), x: t.offsetLeft, y: t.offsetTop, w: t.offsetWidth, h: t.offsetHeight },
    );
    const w = own ? container.offsetWidth : container.scrollWidth;
    const h = own ? container.offsetHeight : container.scrollHeight;
    const plan = planBoard(this.atlas, w, h, placed);
    const ctx0 = plan && document.createElement('canvas').getContext('2d');
    if (!plan || !ctx0) return null;
    const canvas = ctx0.canvas;
    canvas.width = plan.width;
    canvas.height = plan.height;
    canvas.className = 'lt-board';
    canvas.setAttribute('aria-hidden', 'true');
    // A tile's own board fills it, so it grows with the tile at the launch.
    Object.assign(canvas.style, own ? { width: '100%', height: '100%' } : { width: `${w}px`, height: `${h}px` });
    const corners = own ? null : cornerMask(plan, tiles);
    const gate = container.closest('.lt-gallery');
    const board: Board = { canvas, ctx: ctx0, plan, corners, own, tiles, gate, frozen: false };
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
   * boards go. Returns a function that freezes all but `keep` on their frame,
   * as the gallery stops (redrawing ~70 leaving tiles cost the launch frames).
   */
  separate(root: HTMLElement): (keep: HTMLElement | null) => void {
    this.prune();
    const shared = [...this.boards].filter((b) => !b.own && root.contains(b.canvas));
    for (const b of shared) {
      const onScreen = b.tiles.filter((t) => {
        const r = t.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      });
      this.removeBoard(b, false);
      onScreen.forEach((t) => this.addBoard(t, [t]));
    }
    return (keep) => {
      for (const b of this.boards) {
        if (!root.contains(b.canvas) || b.tiles[0] === keep) continue;
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
