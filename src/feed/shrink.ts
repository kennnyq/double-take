/**
 * Geometry for the "video shrinks above the sheet" effect. Pure so it can be
 * unit-tested with `node --test`.
 */

/** Bottom sheets (comments, share) cover this fraction of the window height. */
export const SHEET_FRACTION = 0.62;

export function sheetHeight(windowHeight: number): number {
  return Math.round(windowHeight * SHEET_FRACTION);
}

/**
 * Transform for the feed (which starts at the top of the window and is
 * `feedHeight` tall) so the current page fits between the status bar and the
 * top of the sheet. Apply as `[{ translateY: dy }, { scale }]` (scale is about
 * the view's centre, so horizontal centring comes for free).
 */
export function shrinkGeometry(
  feedHeight: number,
  windowHeight: number,
  topInset: number,
): { scale: number; dy: number } {
  if (feedHeight <= 0 || windowHeight <= 0) return { scale: 1, dy: 0 };
  const top = topInset + 6;
  const available = Math.max(40, windowHeight - sheetHeight(windowHeight) - top - 10);
  const scale = Math.min(1, available / feedHeight);
  const dy = top - (feedHeight * (1 - scale)) / 2;
  return { scale, dy };
}
