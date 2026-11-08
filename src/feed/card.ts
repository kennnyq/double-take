/**
 * Where the double take's info card floats. Pure, so it runs under `node --test`.
 *
 * With a highlighted area, the card sits just below it (or above, when there's
 * no room below), centred on it as far as the stage allows. Without one, it
 * goes to the top or bottom of the stage, whichever shows less of the video:
 * the tell's own `placement` when the annotation pipeline gave one, else
 * `emptierSide` guesses from the layout and the clip's other tells.
 */
import type { Rect } from './spotlight.ts';

export type Side = 'top' | 'bottom';

export interface CardSpot {
  /** Which stage edge the card is anchored to; it grows away from it. */
  side: Side;
  /** Distance from that edge to the card's near edge, in stage px. */
  offset: number;
  /** Horizontal centre and width of the card. */
  cx: number;
  width: number;
  /** Where the card comes in from (and leaves to): from below when it sits under the subject, from above when over it. */
  from: 'above' | 'below';
}

export interface CardSpotInput {
  /** The highlighted area in stage px (with its padding), if the tell has one. */
  hole: Rect | null;
  /** The tell's own box: the card never covers it if there's any way not to. */
  subject?: Rect | null;
  /** Where a tell without an area goes (see `emptierSide`). */
  placement: Side;
  stageW: number;
  stageH: number;
  /** Expected card height (see `estimateCardHeight`). */
  cardH: number;
  /** Keep-out at the top (status bar, Close button) and bottom of the stage. */
  safeTop: number;
  safeBottom: number;
  /** Space between the card and the highlighted area. */
  gap?: number;
  maxWidth?: number;
  margin?: number;
}

export function cardSpot(i: CardSpotInput): CardSpot {
  const gap = i.gap ?? 20;
  const margin = i.margin ?? 12;
  const width = Math.max(0, Math.min(i.maxWidth ?? 320, i.stageW - 2 * margin));
  const centre = (x: number) => Math.min(i.stageW - margin - width / 2, Math.max(margin + width / 2, x));
  const { hole } = i;
  if (!hole) {
    const top = i.placement === 'top';
    return { side: i.placement, offset: top ? i.safeTop : i.safeBottom, cx: i.stageW / 2, width, from: top ? 'above' : 'below' };
  }
  const cx = centre(hole.x + hole.w / 2);
  const below = (r: Rect, g: number) => ({ top: r.y + r.h + g, room: i.stageH - i.safeBottom - (r.y + r.h + g) });
  const above = (r: Rect, g: number) => ({ bottom: i.stageH - r.y + g, room: r.y - g - i.safeTop });
  const at = (side: 'below' | 'above', offset: number): CardSpot =>
    side === 'below' ? { side: 'top', offset, cx, width, from: 'below' } : { side: 'bottom', offset, cx, width, from: 'above' };
  // Clear of the padded area with a comfortable gap; failing that, at least clear of the subject itself.
  for (const [r, g] of [
    [hole, gap],
    [i.subject ?? hole, Math.min(gap, 10)],
  ] as const) {
    const b = below(r, g);
    const a = above(r, g);
    const fitsBelow = b.room >= i.cardH;
    const fitsAbove = a.room >= i.cardH;
    if (fitsBelow && fitsAbove) return i.placement === 'bottom' || b.room >= a.room * 1.5 ? at('below', b.top) : at('above', a.bottom);
    if (fitsBelow) return at('below', b.top);
    if (fitsAbove) return at('above', a.bottom);
  }
  // The subject fills the stage: the roomier side, kept on stage.
  const r = i.subject ?? hole;
  const b = below(r, 10);
  const a = above(r, 10);
  if (b.room >= a.room) return at('below', Math.max(i.safeTop, Math.min(b.top, i.stageH - i.safeBottom - i.cardH)));
  return at('above', Math.max(i.safeBottom, Math.min(a.bottom, i.stageH - i.safeTop - i.cardH)));
}

/** A card's height from its text, before it's laid out (15/20 type, 14px padding, the hint and progress line). */
export function estimateCardHeight(text: string, width: number, withHint = true): number {
  const perLine = Math.max(10, Math.floor((width - 28) / 7.4));
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let used = 0;
  for (const w of words) {
    const add = used ? w.length + 1 : w.length;
    if (used + add > perLine && used > 0) {
      lines++;
      used = w.length;
    } else used += add;
  }
  return 24 + lines * 20 + (withHint ? 20 : 0) + 10;
}

/**
 * Which half of the stage shows less of the video, for a card without an area:
 *  - a letterboxed clip: the bigger empty band (no video there at all);
 *  - else away from the clip's other highlighted areas, where its subject is;
 *  - else the top (feeds keep captions and controls at the bottom).
 */
export function emptierSide(frame: Rect, stageH: number, otherHoles: Rect[], minBand = 72): Side {
  const topBand = Math.max(0, frame.y);
  const bottomBand = Math.max(0, stageH - (frame.y + frame.h));
  if (Math.max(topBand, bottomBand) >= minBand) return topBand > bottomBand ? 'top' : 'bottom';
  if (otherHoles.length) {
    const cy = otherHoles.reduce((s, r) => s + r.y + r.h / 2, 0) / otherHoles.length;
    return cy < frame.y + frame.h / 2 ? 'bottom' : 'top';
  }
  return 'top';
}
