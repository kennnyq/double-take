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
}

export interface CardSpotInput {
  /** The highlighted area in stage px, if the tell has one. */
  hole: Rect | null;
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
  const gap = i.gap ?? 12;
  const margin = i.margin ?? 12;
  const width = Math.max(0, Math.min(i.maxWidth ?? 320, i.stageW - 2 * margin));
  const centre = (x: number) => Math.min(i.stageW - margin - width / 2, Math.max(margin + width / 2, x));
  const { hole } = i;
  if (!hole) {
    return { side: i.placement, offset: i.placement === 'top' ? i.safeTop : i.safeBottom, cx: i.stageW / 2, width };
  }
  const cx = centre(hole.x + hole.w / 2);
  const below = i.stageH - i.safeBottom - (hole.y + hole.h + gap);
  const above = hole.y - gap - i.safeTop;
  const fitsBelow = below >= i.cardH;
  const fitsAbove = above >= i.cardH;
  // Both fit: the tell's preferred side. One fits: that one. Neither: the roomier side, kept on stage.
  const goBelow = fitsBelow && fitsAbove ? i.placement === 'bottom' || below >= above * 1.5 : fitsBelow ? true : fitsAbove ? false : below >= above;
  if (goBelow) {
    const top = Math.max(i.safeTop, Math.min(hole.y + hole.h + gap, i.stageH - i.safeBottom - i.cardH));
    return { side: 'top', offset: top, cx, width };
  }
  const bottom = Math.max(i.safeBottom, Math.min(i.stageH - hole.y + gap, i.stageH - i.safeTop - i.cardH));
  return { side: 'bottom', offset: bottom, cx, width };
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
