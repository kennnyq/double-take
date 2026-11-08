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

// ---- the double take's inset ------------------------------------------------

/**
 * The corner radius of an iPhone's display, in points, from its screen size
 * (there's no API for it). Phones not listed, and other platforms, get a
 * modest radius that still reads as a card.
 */
export function displayCornerRadius(screenW: number, screenH: number, os: string): number {
  if (os !== 'ios') return os === 'web' ? 18 : 24;
  const w = Math.round(Math.min(screenW, screenH));
  const h = Math.round(Math.max(screenW, screenH));
  const key = `${w}x${h}`;
  const known: Record<string, number> = {
    '375x812': 39, // X, XS, 11 Pro, 12/13 mini
    '414x896': 41.5, // XR, XS Max, 11, 11 Pro Max
    '390x844': 47.33, // 12, 13, 14
    '428x926': 53.33, // 12/13 Pro Max, 14 Plus
    '393x852': 55, // 14 Pro, 15, 15 Pro, 16
    '430x932': 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    '402x874': 62, // 16 Pro, 17, 17 Pro
    '440x956': 62, // 16 Pro Max, 17 Pro Max
    '420x912': 62, // Air
  };
  return known[key] ?? (h / w > 2 ? 44 : 0);
}

/**
 * The double take insets the video like a card: scaled down about its centre
 * so it sits `gap` points in from the sides and the top of the screen, with
 * corners concentric with the display's (radius minus the gap). The radius is
 * returned in unscaled points, since it's set on the view being scaled.
 */
export function inspectInset(stageW: number, stageH: number, displayRadius: number, gap = 12): { scale: number; dy: number; radius: number } {
  if (stageW <= 0 || stageH <= 0) return { scale: 1, dy: 0, radius: 0 };
  const scale = (stageW - 2 * gap) / stageW;
  const dy = gap - (stageH * (1 - scale)) / 2;
  const visible = Math.max(12, displayRadius - gap);
  return { scale, dy, radius: visible / scale };
}
