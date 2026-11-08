/**
 * Where the desktop comments panel goes: docked to the right of the active
 * clip's action column, with the up/down buttons still free beside it. When
 * the right-hand side is too narrow, the feed slides left to make room (as
 * little as it can); when even that isn't enough, the panel sits over the
 * right edge instead.
 */

export const PANEL_MAX = 360;
export const PANEL_MIN = 320;
/** Between the action column and the panel. */
export const PANEL_GAP = 12;
/** Kept free on the right for the up/down buttons (56px, 24px from the edge, 16px gap). */
export const NAV_ROOM = 96;
/** The card never slides closer than this to the left edge. */
const EDGE = 16;
/** Below this, the author and caption move into the card (as in narrow windows). */
const INFO_MIN = 240;

export interface PanelLayout {
  /** How far the feed's centre moves left. */
  shift: number;
  /** Panel position, from the feed's left edge. */
  left: number;
  width: number;
  /** The author column is too narrow beside the card: show it inside the card. */
  compact: boolean;
  /** No room beside the clip: the panel covers the right edge (and the up/down buttons). */
  overlay: boolean;
}

export function panelLayout(wrapW: number, cardW: number, actionsW: number): PanelLayout {
  const side = (wrapW - cardW) / 2;
  const need = actionsW + PANEL_GAP + PANEL_MAX + NAV_ROOM;
  const shift = Math.round(Math.min(Math.max(0, need - side), Math.max(0, side - EDGE)));
  const left = Math.round(wrapW / 2 - shift + cardW / 2 + actionsW + PANEL_GAP);
  const width = Math.min(PANEL_MAX, wrapW - NAV_ROOM - left);
  const compact = side - shift < INFO_MIN;
  if (width >= PANEL_MIN) return { shift, left, width, compact, overlay: false };
  // Too tight to dock: leave the feed centred and lay the panel over the right edge.
  const w = Math.min(PANEL_MAX, wrapW - 2 * EDGE);
  return { shift: 0, left: wrapW - EDGE - w, width: w, compact: side < INFO_MIN, overlay: true };
}
