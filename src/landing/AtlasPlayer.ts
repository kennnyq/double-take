import { atlasMode, cellRect, clipTime, planBoard, type Atlas, type AtlasMode, type BoardPlan, type PlacedTile } from './atlas';
import { streamLoop } from './atlasStream';
import { BUSYNESS, chooseNext, fits, FADE_MS, handover, loopAt, snap, soft, SWIPE_MS, swipeSlices, type Busyness, type Neighbour, type Planned, type Turn } from './reels';
import { likeness, spreadCells, stripLoops, stripSequence, type Spot } from './spread';
import { PHONE_SWIPES, type Tier } from './tier';

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
 * As each tile's clip ends, it "scrolls to the next reel" (`reels.ts`): the
 * clip slides up and out as the next slides in from below, from its first
 * frame, cut from the same atlas, so it costs no decoder. Swiping tiles
 * redraw every frame while they move; the rest, at the atlas's 15 fps.
 */

/** A tile's swipe from one cell to another, starting at `start` (performance.now() ms): before then it still shows `from`. */
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
  /** Tiles no longer drawn here (gone to a canvas of their own, or left): their place stays clear. */
  hidden: boolean[];
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
  /**
   * The video's current frame, copied once per frame: every tile is cut from
   * this rather than from the video. Drawing from a <video> can convert the
   * whole frame each time (WebKit does), and boards draw hundreds of tiles.
   */
  private frame: CanvasRenderingContext2D | null = null;
  private framed = false;
  private boards = new Set<Board>();
  private visible = new Set<Board>();
  /** Observed elements (canvases and gates) that are on screen. */
  private seen = new Set<Element>();
  private gates = new Map<Element, number>();
  private io: IntersectionObserver;
  private frameRequested = false;
  private wantVideo = false;
  /** Whether tiles swipe as their clips end. */
  private reels = false;
  /** Atlas times of swipes coming up, to keep them from bunching (reels.ts: CLASH). */
  private busy: number[] = [];
  /** Tiles that found no clip to hand over to this time round, by key: the loop they're in. Their clip loops instead. */
  private noHandover = new Map<string, number>();
  /** How busy the wall may be (reels.ts: Busyness), the turns planned, and when each tile's clip came in (atlas time). */
  private busyness: Busyness = BUSYNESS.medium;
  private planned: Planned[] = [];
  private shownSince = new Map<string, number>();
  /** The lighter tier caps swipes (tier.ts). */
  private tier: Tier = 'full';
  /** How tiles turn to their next clip, and how long that takes (ms). */
  private turn: Turn = 'slide';
  private turnMs = SWIPE_MS;
  private lastSwipeFrame = 0;
  /** Swipes stop for the launch. */
  private held = false;
  private swiping = new Set<Board>();
  private swipeFrame = 0;
  /** The feed index of the clip in each cell, for the tile's `data-clip`. */
  private clipOfCell = new Map<number, number>();
  /** Each strip's set of clips (spread.ts: stripLoops), which its swipes keep to. */
  private stripSets = new WeakMap<Element, readonly number[]>();
  /** Each strip's place in its gallery (rows top to bottom, columns left to right) and how many tiles its loop holds. */
  private stripAt = new WeakMap<Element, { k: number; places: number }>();
  /** For each cell, it and any other cell of the same footage. */
  private sameAs: number[][] | null = null;

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
    const make = () => {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, playsInline: true, preload: 'auto' });
      v.setAttribute('aria-hidden', 'true');
      v.dataset.atlas = '';
      // Kept in the document (Safari won't play it detached) but out of sight.
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      v.addEventListener(
        'loadeddata',
        () => {
          this.copyFrame(v);
          this.drawAll();
        },
        { once: true },
      );
      return v;
    };
    const v = make();
    const { mime, loop } = this.atlas;
    // Made before streaming starts: a browser may detach the bytes it is handed.
    const file = new Blob([bytes], { type: 'video/mp4' });
    // The plain file, looping, on a fresh element: where Media Source isn't
    // there, or takes the stream but can't play it (some WebKit builds fail to
    // decode through it, and the element then stays broken).
    const plain = (into: HTMLVideoElement) => {
      into.loop = true;
      into.src = URL.createObjectURL(file);
    };
    if (!mime || !streamLoop(v, bytes, mime, loop)) plain(v);
    else
      v.addEventListener(
        'error',
        () => {
          const fresh = make();
          plain(fresh);
          v.replaceWith(fresh);
          this.video = fresh;
          this.wantVideo = false;
          this.frameRequested = false;
          this.update();
        },
        { once: true },
      );
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
    const next = (now: number, meta?: VideoFrameCallbackMetadata) => {
      this.frameRequested = false;
      if (!this.wantVideo) return;
      // Where on the atlas's timeline this frame is, and when it shows.
      const t = meta?.mediaTime ?? v.currentTime;
      const shows = meta?.expectedDisplayTime ?? now;
      this.copyFrame(v);
      this.tickReels(t, shows);
      this.visible.forEach((b) => this.draw(b));
      this.request();
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame((now) => next(now));
  }

  /** Copies the video's frame into the one canvas tiles are cut from. */
  private copyFrame(v: HTMLVideoElement) {
    if (v.readyState < 2 || !v.videoWidth) return;
    if (!this.frame || this.frame.canvas.width !== v.videoWidth) {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      this.frame = c.getContext('2d');
    }
    this.frame?.drawImage(v, 0, 0);
    this.framed = !!this.frame;
  }

  private source(): CanvasImageSource | null {
    if (this.framed && this.frame) return this.frame.canvas;
    if (this.video && this.video.readyState >= 2) return this.video;
    if (this.still?.complete && this.still.naturalWidth) return this.still;
    return null;
  }

  /** Draws a board's tiles (or just tiles `only`), each mid-swipe where it is. */
  private draw(b: Board, now = performance.now(), only?: readonly number[]) {
    const src = this.source();
    const { ctx, plan, corners } = b;
    const which = only ?? plan.draws.map((_, i) => i);
    for (const i of which) {
      if (b.hidden[i]) continue;
      const d = plan.draws[i];
      if (!src) {
        ctx.fillStyle = EMPTY;
        ctx.fillRect(d.dx, d.dy, d.dw, d.dh);
        continue;
      }
      const at = (cell: number) => {
        const c = cellRect(this.atlas, cell);
        return { sx: c.sx + d.ox, sy: c.sy + d.oy };
      };
      const swipe = b.swipes[i];
      if (swipe) {
        const t = (now - swipe.start) / this.turnMs;
        if (t < 1) {
          if (this.turn === 'fade') {
            const from = at(swipe.from);
            const to = at(swipe.to);
            ctx.drawImage(src, from.sx, from.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
            ctx.globalAlpha = soft(t);
            ctx.drawImage(src, to.sx, to.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
            ctx.globalAlpha = 1;
          } else
            for (const x of swipeSlices(snap(t), d, at(swipe.from), at(swipe.to)))
              ctx.drawImage(src, x.sx, x.sy, x.sw, x.sh, x.dx, x.dy, x.dw, x.dh);
          if (only && corners) this.cornersOf(b, d);
          continue;
        }
        b.swipes[i] = undefined;
      }
      const { sx, sy } = at(b.cells[i]);
      ctx.drawImage(src, sx, sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      if (only && corners) this.cornersOf(b, d);
    }
    if (corners && !only) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(corners, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Rounds one tile's corners again after it alone was redrawn. */
  private cornersOf(b: Board, d: { dx: number; dy: number; dw: number; dh: number }) {
    const x = Math.floor(d.dx);
    const y = Math.floor(d.dy);
    const w = Math.ceil(d.dx + d.dw) - x;
    const h = Math.ceil(d.dy + d.dh) - y;
    b.ctx.globalCompositeOperation = 'destination-out';
    b.ctx.drawImage(b.corners!, x, y, w, h, x, y, w, h);
    b.ctx.globalCompositeOperation = 'source-over';
  }

  private drawAll() {
    this.boards.forEach((b) => this.draw(b));
  }

  /** Whether tiles swipe as their clips end (false: they loop), and which feed clip each cell holds. */
  setReels(on: boolean, clipOfCell: Map<number, number>, tier: Tier = 'full', turn?: Turn, busyness: Busyness = BUSYNESS.medium) {
    this.tier = tier;
    this.busyness = busyness;
    // A swipe on the full tier; a soft crossfade on the lighter one (it read as flashy and jittery on phones).
    this.turn = turn ?? (tier === 'phone' ? 'fade' : 'slide');
    this.turnMs = this.turn === 'fade' ? FADE_MS : SWIPE_MS;
    this.reels = on && this.mode === 'play' && !!this.atlas.phases;
    this.clipOfCell = clipOfCell;
    this.held = false;
  }

  /**
   * On each atlas frame (`t`, which shows at `shows`, performance.now() ms):
   * every tile on screen whose clip is coming to its end picks the clip it
   * hands over to (reels.ts: chooseNext) and swipes the instant that one
   * starts. Off screen, and when no clip fits, a clip just loops.
   */
  private tickReels(t: number, shows: number) {
    const phases = this.atlas.phases;
    if (!this.reels || this.held || document.hidden || !phases) return;
    const { loop, lead } = this.atlas;
    const span = handover(loop, lead, 2, this.turnMs);
    const wallAt = (at: number) => shows + (at - t) * 1000;
    this.busy = this.busy.filter((b) => b > t - 1);
    this.planned = this.planned.filter((p) => p.at > t - 2);
    const { hold } = this.busyness;
    // Tiles due to hand over: every copy of each (a strip holds each twice).
    const due = new Map<string, [Board, number][]>();
    for (const b of this.visible) {
      if (!b.gate || b.frozen) continue;
      b.tiles.forEach((el, i) => {
        if (el.hasAttribute('data-hero-tile') || b.hidden[i]) return;
        const key = b.keys[i];
        const swipe = b.swipes[i];
        if (swipe && wallAt(t) < swipe.start + this.turnMs) return;
        const cell = b.cells[i];
        const into = loopAt(t, phases[cell], loop);
        if (into < span.from || into > span.until) return;
        const round = Math.floor((t + phases[cell]) / loop);
        if (this.noHandover.get(key) === round) return;
        // Held long enough? If not, its clip loops once more. (First seen: as if it
        // came in a little while ago, so the wall doesn't all turn at once.)
        if (!this.shownSince.has(key)) this.shownSince.set(key, t - Math.random() * hold);
        if (t + (span.until - into) - this.shownSince.get(key)! < hold) {
          this.noHandover.set(key, round);
          return;
        }
        due.set(key, [...(due.get(key) ?? []), [b, i]]);
      });
    }
    if (!due.size) return;
    // The lighter tier: only so many swipes moving or about to, at once.
    let room = Infinity;
    if (this.tier === 'phone') {
      let busy = 0;
      for (const b of this.visible) for (const sw of b.swipes) if (sw && sw.start + this.turnMs > shows) busy++;
      room = PHONE_SWIPES.concurrent - busy;
      if (room <= 0) return;
    }
    // Where every tile on screen is, and the clip it shows or is about to.
    const where = new Map<string, Neighbour & { size: number }>();
    for (const b of this.visible) {
      if (!b.gate || b.frozen) continue;
      b.tiles.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return;
        where.set(b.keys[i], { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, r.height), cell: b.cells[i] });
      });
    }
    const shown = this.stripsShowing();
    due.forEach((members, key) => {
      const me = where.get(key);
      if (!me || room <= 0) return;
      const [b0, i0] = members[0];
      const cell = b0.cells[i0];
      const into = loopAt(t, phases[cell], loop);
      const strip = b0.tiles[i0].parentElement?.closest('.lt-row, .lt-col');
      const allow = strip ? this.allowedIn(strip, Number(b0.tiles[i0].dataset.twin ?? i0), shown) : undefined;
      const next = chooseNext({
        tile: { ...me, cell },
        t,
        until: t + (span.until - into),
        phases,
        loop,
        neighbours: [...where].filter(([k]) => k !== key).map(([, n]) => n),
        distances: this.atlas.distances,
        prefer: strip ? this.stripSets.get(strip) : undefined,
        allow,
        busy: this.busy,
        fitsAt: (at) => fits(this.planned, at, me.x, me.y, me.size, this.busyness),
      });
      if (!next) {
        this.noHandover.set(key, Math.floor((t + phases[cell]) / loop));
        return;
      }
      this.busy.push(next.at);
      this.planned.push({ at: next.at, x: me.x, y: me.y, size: me.size });
      this.shownSince.set(key, next.at);
      room--;
      me.cell = next.cell;
      // Its strip shows the new clip from now on, for the tiles that turn after it.
      const showing = strip && shown.get(strip);
      if (showing) showing.set(next.cell, [...(showing.get(next.cell) ?? []), Number(b0.tiles[i0].dataset.twin ?? i0)]);
      for (const [b, i] of members) {
        b.swipes[i] = { from: b.cells[i], to: next.cell, start: wallAt(next.at) };
        b.cells[i] = next.cell;
        // A press on it from now opens the feed on its new clip.
        const el = b.tiles[i];
        el.dataset.cell = String(next.cell);
        const clip = this.clipOfCell.get(next.cell);
        if (clip !== undefined) el.dataset.clip = String(clip);
        this.swiping.add(b);
      }
    });
    this.animateSwipes();
  }

  /**
   * What each strip shows, by cell: the places (twin numbers) showing it,
   * counting a clip still on its way out of a tile that is turning.
   */
  private stripsShowing(): Map<Element, Map<number, number[]>> {
    const shown = new Map<Element, Map<number, number[]>>();
    for (const b of this.boards)
      b.tiles.forEach((el, i) => {
        const strip = el.parentElement?.closest('.lt-row, .lt-col');
        if (!strip || b.hidden[i]) return;
        const cells = shown.get(strip) ?? new Map<number, number[]>();
        shown.set(strip, cells);
        const place = Number(el.dataset.twin ?? i);
        const add = (cell: number) => {
          const at = cells.get(cell);
          if (!at) cells.set(cell, [place]);
          else if (!at.includes(place)) at.push(place);
        };
        add(b.cells[i]);
        const sw = b.swipes[i];
        if (sw) add(sw.from);
      });
    return shown;
  }

  /**
   * Which clips a tile at `place` on `strip` may turn to: none that any strip
   * within two of it shows (it slides past them, so they'd line up), and none
   * shown within two places of it along its own strip, round its wrap.
   * The same footage under another id counts as the same clip.
   */
  private allowedIn(strip: Element, place: number, shown: Map<Element, Map<number, number[]>>): (cell: number) => boolean {
    const me = this.stripAt.get(strip);
    if (!me) return () => true;
    const n = this.atlas.ids.length;
    this.sameAs ??= Array.from({ length: n }, (_, a) =>
      [...Array(n).keys()].filter((b) => a === b || likeness(a, b, this.atlas.distances) >= 0.9),
    );
    const gallery = strip.closest('.lt-gallery');
    const near = new Set<number>();
    shown.forEach((cells, other) => {
      const at = this.stripAt.get(other);
      if (!at || other.closest('.lt-gallery') !== gallery) return;
      const apart = Math.abs(at.k - me.k);
      if (apart > 2) return;
      cells.forEach((places, cell) => {
        const close =
          apart > 0 ||
          places.some((p) => {
            const d = Math.abs(p - place) % me.places;
            return p !== place && Math.min(d, me.places - d) <= 2;
          });
        if (close) near.add(cell);
      });
    });
    return (cell) => !this.sameAs![cell].some((c) => near.has(c));
  }

  /** Redraws tiles mid-swipe every frame (only them), until their swipes settle. */
  private animateSwipes() {
    if (this.swipeFrame) return;
    const step = () => {
      const now = performance.now();
      // The lighter tier redraws swipes at most every PHONE_SWIPES.frameMs.
      if (this.tier === 'phone' && now - this.lastSwipeFrame < PHONE_SWIPES.frameMs - 4) {
        this.swipeFrame = requestAnimationFrame(step);
        return;
      }
      this.lastSwipeFrame = now;
      for (const b of this.swiping) {
        const moving: number[] = [];
        let waiting = false;
        b.swipes.forEach((sw, i) => {
          if (!sw) return;
          if (now < sw.start) waiting = true;
          else moving.push(i);
        });
        if (moving.length && this.visible.has(b)) this.draw(b, now, moving);
        if (!waiting && !b.swipes.some(Boolean)) this.swiping.delete(b);
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
  addBoard(container: HTMLElement, tiles: HTMLElement[], ownSize?: { w: number; h: number }): Board | null {
    const own = tiles.length === 1 && tiles[0] === container;
    const size = own ? ownSize ?? { w: container.offsetWidth, h: container.offsetHeight } : null;
    const box = size
      ? { ...size, tiles: [{ x: 0, y: 0, ...size }] }
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
      hidden: tiles.map(() => false),
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
  mount(root: HTMLElement, clipOfCell?: Map<number, number>): () => void {
    const made: Board[] = [];
    const tiles = [...root.querySelectorAll<HTMLElement>('[data-tile][data-cell]')];
    if (clipOfCell && root.closest('.lt-gallery')) this.spread(tiles, clipOfCell);
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

  /**
   * Deals the gallery's clips out afresh so that the same clip, and clips that
   * look alike, sit as far apart as they can (spread.ts): rows and columns
   * from two alternating loops, so strips sliding past each other never meet
   * their own clips; any other tiles by where they are. A strip's two copies
   * of a tile count as one.
   */
  private spread(tiles: HTMLElement[], clipOfCell: Map<number, number>) {
    const gallery = tiles[0]?.closest<HTMLElement>('.lt-gallery');
    if (!gallery) return;
    const deal = (members: HTMLElement[], cell: number) => {
      for (const t of members) {
        t.dataset.cell = String(cell);
        const clip = clipOfCell.get(cell);
        if (clip !== undefined) t.dataset.clip = String(clip);
      }
    };
    const strips = new Map<HTMLElement, Map<string, HTMLElement[]>>();
    const loose: HTMLElement[] = [];
    for (const t of tiles) {
      if (t.hasAttribute('data-hero-tile')) continue;
      const strip = t.parentElement?.closest<HTMLElement>('.lt-row, .lt-col');
      if (!strip || t.dataset.twin === undefined) {
        loose.push(t);
        continue;
      }
      const byTwin = strips.get(strip) ?? new Map<string, HTMLElement[]>();
      byTwin.set(t.dataset.twin, [...(byTwin.get(t.dataset.twin) ?? []), t]);
      strips.set(strip, byTwin);
    }
    // Strips and planes laid out flat for a moment: where things are, without
    // the tilt or how far each strip has slid.
    const flat = [...gallery.querySelectorAll<HTMLElement>('[data-plane], [data-board]')];
    const saved = flat.map((el) => [el.style.getPropertyValue('transform'), el.style.getPropertyPriority('transform')] as const);
    flat.forEach((el) => el.style.setProperty('transform', 'none', 'important'));
    const g = gallery.getBoundingClientRect();
    const order = [...strips.keys()]
      .map((el) => ({ el, r: el.getBoundingClientRect(), col: el.classList.contains('lt-col') }))
      .sort((a, b) => (a.col ? a.r.left - b.r.left : a.r.top - b.r.top));
    const spots: Spot[] = loose.map((t, i) => {
      const r = t.getBoundingClientRect();
      return { key: String(i), x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.min(r.width, r.height) };
    });
    flat.forEach((el, i) => {
      const [value, priority] = saved[i];
      if (value) el.style.setProperty('transform', value, priority);
      else el.style.removeProperty('transform');
    });
    const n = this.atlas.ids.length;
    const loops = stripLoops(n, this.atlas.distances);
    order.forEach(({ el }, k) => {
      this.stripSets.set(el, loops[k % loops.length]);
      const byTwin = strips.get(el)!;
      this.stripAt.set(el, { k, places: byTwin.size });
      const seq = stripSequence(loops, k, byTwin.size, this.atlas.distances);
      byTwin.forEach((members, twin) => deal(members, seq[Number(twin) % seq.length]));
    });
    if (spots.length) {
      const cells = spreadCells(spots, n, this.atlas.distances, { x: g.left + g.width / 2, y: g.top + g.height / 2 });
      cells.forEach((cell, key) => deal([loose[Number(key)]], cell));
    }
  }

  /** Drops boards whose canvas has left the page (a launch's, once the landing is gone). */
  private prune() {
    this.boards.forEach((b) => !b.canvas.isConnected && this.removeBoard(b));
  }

  /**
   * For the launch, which moves and fades tiles one by one. No new swipes
   * start (ones not begun are called off, ones under way finish). Each tile
   * on a shared strip is given a canvas of its own only as it begins to leave
   * (`detach`): making all ~70 at the press stalled the screen for up to
   * 150 ms. `hide` takes a tile off its strip without one (it isn't seen
   * leaving), and `freeze` leaves a tile on its last frame once it's gone.
   */
  release(root: HTMLElement) {
    this.prune();
    this.held = true;
    const now = performance.now();
    for (const b of this.boards) {
      b.swipes.forEach((sw, i) => {
        if (!sw || sw.start <= now) return;
        b.cells[i] = sw.from;
        b.swipes[i] = undefined;
        const el = b.tiles[i];
        el.dataset.cell = String(sw.from);
        const clip = this.clipOfCell.get(sw.from);
        if (clip !== undefined) el.dataset.clip = String(clip);
      });
    }
    const on = (tile: HTMLElement) => {
      for (const b of this.boards) {
        if (b.own || !root.contains(b.canvas)) continue;
        const i = b.tiles.indexOf(tile);
        if (i >= 0 && !b.hidden[i]) return { b, i };
      }
      return null;
    };
    const takeOff = (b: Board, i: number) => {
      b.hidden[i] = true;
      const d = b.plan.draws[i];
      b.ctx.clearRect(Math.floor(d.dx) - 1, Math.floor(d.dy) - 1, Math.ceil(d.dw) + 2, Math.ceil(d.dh) + 2);
      if (b.hidden.every(Boolean)) this.removeBoard(b, false);
    };
    return {
      detach: (tile: HTMLElement) => {
        const at = on(tile);
        if (!at) return;
        // The strip already measured this tile. Reuse that size so each exit
        // does not force layout while the preceding cards are animating.
        const draw = at.b.plan.draws[at.i];
        const own = this.addBoard(tile, [tile], {
          w: Math.round(draw.dw / at.b.plan.scale),
          h: Math.round(draw.dh / at.b.plan.scale),
        });
        const swipe = at.b.swipes[at.i];
        if (own && swipe) {
          own.swipes[0] = swipe;
          this.swiping.add(own);
          this.animateSwipes();
        }
        takeOff(at.b, at.i);
      },
      hide: (tile: HTMLElement) => {
        const at = on(tile);
        if (at) takeOff(at.b, at.i);
      },
      freeze: (tile: HTMLElement) => {
        for (const b of this.boards) {
          if (!b.own || b.tiles[0] !== tile) continue;
          // Stays on the page as it is (the landing's unmounting takes it down), no longer redrawn.
          b.frozen = true;
          this.visible.delete(b);
        }
        this.update();
      },
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
