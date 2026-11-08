/**
 * The gallery atlas: every gallery clip, small, in one looping video laid out
 * as a grid of cells. One download and one decoder feed every tile on the
 * page; tiles are cut out of it and drawn onto a few canvases ("boards").
 *
 * Pure logic only (no DOM), so it is testable in node. The player that draws
 * the boards is `AtlasPlayer.ts`.
 */

/** `atlas.json`, as `scripts/harvest/build_atlas.py` writes it. */
export interface AtlasManifest {
  version: 1;
  /** The looping video, relative to the manifest. */
  src: string;
  /** Its first frame as a still, relative to the manifest. */
  poster?: string;
  cols: number;
  rows: number;
  /** One cell's size in the video, in pixels. */
  cellW: number;
  cellH: number;
  fps: number;
  /** Loop length, in seconds. */
  loop: number;
  /** Where in each clip the loop starts, in seconds (its end fades into the clip's first `lead`). */
  lead: number;
  /** The clip in each cell, in cell order: the Worker's clip ids. */
  ids: string[];
  /** Each cell's own loop starts this many seconds into the atlas's, so cells don't all loop at once. */
  phases?: number[];
  /** Its MIME type with codecs, for Media Source (the atlas is a fragmented MP4). */
  mime?: string;
}

/** A manifest with its media resolved to absolute URLs. */
export interface Atlas extends AtlasManifest {
  srcUrl: string;
  posterUrl?: string;
}

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The manifest at `url`, or null when it is missing or not one (a dev server answers any path with the app). */
export function parseAtlas(json: unknown, url: string): Atlas | null {
  if (!json || typeof json !== 'object') return null;
  const m = json as Partial<AtlasManifest>;
  if (m.version !== 1 || typeof m.src !== 'string' || !Array.isArray(m.ids)) return null;
  if (![m.cols, m.rows, m.cellW, m.cellH, m.fps, m.loop].every(isPositive)) return null;
  if (!m.ids.every((id) => typeof id === 'string') || m.ids.length > m.cols! * m.rows!) return null;
  // Relative to the manifest; a same-origin path stays a path.
  const absolute = /^https?:\/\//.test(url);
  const abs = (p: string) => {
    const u = new URL(p, absolute ? url : new URL(url, 'http://local/'));
    return absolute ? u.href : u.pathname + u.search;
  };
  const phases =
    Array.isArray(m.phases) && m.phases.length === m.ids.length && m.phases.every((p) => typeof p === 'number')
      ? m.phases
      : undefined;
  return {
    ...(m as AtlasManifest),
    phases,
    mime: typeof m.mime === 'string' ? m.mime : undefined,
    lead: typeof m.lead === 'number' && m.lead >= 0 ? m.lead : 0,
    srcUrl: abs(m.src),
    posterUrl: typeof m.poster === 'string' ? abs(m.poster) : undefined,
  };
}

/** Each clip id's cell. */
export function cellsById(atlas: Pick<AtlasManifest, 'ids'>): Map<string, number> {
  return new Map(atlas.ids.map((id, cell) => [id, cell]));
}

/** Where cell `n` sits in the atlas video, in its pixels. */
export function cellRect(atlas: Pick<AtlasManifest, 'cols' | 'cellW' | 'cellH'>, n: number) {
  return { sx: (n % atlas.cols) * atlas.cellW, sy: Math.floor(n / atlas.cols) * atlas.cellH, sw: atlas.cellW, sh: atlas.cellH };
}

/** The moment in the clip itself that `cell` shows at atlas time `t`, for picking up the full clip there. */
export function clipTime(atlas: Pick<AtlasManifest, 'lead' | 'loop' | 'phases'>, t: number, cell = 0): number {
  const at = t + (atlas.phases?.[cell] ?? 0);
  return atlas.lead + (((at % atlas.loop) + atlas.loop) % atlas.loop);
}

/** A tile on a board, in CSS pixels from the board's top left. */
export interface PlacedTile {
  cell: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a board's canvas draws: its size in canvas pixels, and each tile's source and target. */
export interface BoardPlan {
  width: number;
  height: number;
  /** Canvas pixels per CSS pixel. */
  scale: number;
  draws: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }[];
}

/** Largest canvas side we'll make; browsers refuse (or tile slowly) beyond about this. */
export const MAX_BOARD_SIDE = 8192;

/**
 * Plan a board: its canvas is drawn at the atlas's own resolution (no sharper
 * than the source, however large the tiles are on screen), so the cost per
 * frame doesn't grow with the screen. Each cell is cropped to the tile's
 * aspect, like `object-fit: cover`.
 */
export function planBoard(
  atlas: Pick<AtlasManifest, 'cols' | 'cellW' | 'cellH'>,
  boardW: number,
  boardH: number,
  tiles: readonly PlacedTile[],
): BoardPlan | null {
  if (!tiles.length || boardW <= 0 || boardH <= 0) return null;
  // Sized for the typical tile; the odd big one (the mosaic's) is drawn up from the same cell.
  const typical = tiles.map((t) => t.h).sort((a, b) => a - b)[tiles.length >> 1];
  let scale = Math.min(1.5, atlas.cellH / typical);
  scale = Math.min(scale, MAX_BOARD_SIDE / boardW, MAX_BOARD_SIDE / boardH);
  const draws = tiles.map((t) => {
    const { sx, sy, sw, sh } = cellRect(atlas, t.cell);
    // Cover: crop the cell to the tile's aspect, centred.
    const tileAspect = t.w / t.h;
    const cellAspect = sw / sh;
    let cw = sw;
    let ch = sh;
    if (tileAspect > cellAspect) ch = sw / tileAspect;
    else cw = sh * tileAspect;
    return {
      sx: sx + (sw - cw) / 2,
      sy: sy + (sh - ch) / 2,
      sw: cw,
      sh: ch,
      // Unrounded: a strip's second half must sit exactly one half along, or the
      // picture shifts by a pixel each time the scroll wraps.
      dx: t.x * scale,
      dy: t.y * scale,
      dw: t.w * scale,
      dh: t.h * scale,
    };
  });
  return { width: Math.ceil(boardW * scale), height: Math.ceil(boardH * scale), scale, draws };
}

/** How the gallery moves for this visitor. */
export type AtlasMode = 'play' | 'still';

/**
 * Moving tiles cost about a megabyte and a decoder. Visitors who asked for
 * less motion or less data, or who are on a slow connection, get the atlas's
 * still instead (one image for every tile).
 */
export function atlasMode(env: { reducedMotion: boolean; saveData?: boolean; effectiveType?: string }): AtlasMode {
  if (env.reducedMotion || env.saveData) return 'still';
  if (env.effectiveType && /^(slow-2g|2g|3g)$/.test(env.effectiveType)) return 'still';
  return 'play';
}
