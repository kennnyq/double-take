/**
 * Feed modes: the seams that let something else run inside the feed (the
 * timed round today) without a second feed. The phone feed (`Feed`) and the
 * desktop feed (`DesktopFeed`) take an optional `mode`; without one they are
 * the normal feed. A mode can:
 *
 * - give the feed its own clips (a deck) instead of the endless feed;
 * - present each clip through a transform (e.g. strip what would give an
 *   answer away) before the page sees it;
 * - set the interaction policy: what a double tap does, whether a hold or a
 *   tap does anything, whether the clip's social controls are locked (shown,
 *   dimmed, out of reach), whether the feed's keyboard shortcuts apply, and
 *   whether the list may scroll right now;
 * - listen to events: the clip the feed came to rest on, a double tap;
 * - draw an overlay (a HUD) over the clip's stage.
 *
 * Everything else (paging, the player pool, audio, preloading, the progress
 * bar) stays the feed's own.
 */
import type { ReactNode } from 'react';
import type { Clip } from '../data/clips.ts';

/** How one clip page behaves (see ClipItem / DesktopFeed's Slide). Every field off by default. */
export interface ClipPolicy {
  /** A double tap (or double click) goes here instead of liking or opening the double take. */
  onDoubleTap?: (x: number, y: number) => void;
  /** A hold does nothing (no 2x, no double take). */
  noHold?: boolean;
  /** A single tap does nothing (no play/pause). */
  noTapPause?: boolean;
  /** The clip's social controls (rail, follow, progress bar) show, dimmed and out of reach. */
  lockControls?: boolean;
}

/** Where a clip's video sits in the feed's own frame, for an overlay. */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FeedMode {
  /** The clips to show, as given: no placeholders, no feed-mode filter. */
  clips: readonly Clip[];
  /** How each clip is shown (applied before the page sees it; the media are played as given). */
  present?: (clip: Clip) => Clip;
  /** A double tap on the clip at `index`; replaces like / double take. */
  onDoubleTap?: (index: number, at: { x: number; y: number }) => void;
  noHold?: boolean;
  noTapPause?: boolean;
  lockControls?: boolean;
  /** Desktop: the feed's own keys (Space, ←/→ seek, M). Default on. */
  keys?: boolean;
  /** The list may scroll now. Default on. */
  scrollEnabled?: boolean;
  /** The feed came to rest on another clip (a swipe, the wheel, keys, or `goTo`). */
  onActive?: (index: number) => void;
  /** Drawn over the feed, given the active clip's stage. */
  overlay?: (stage: StageRect) => ReactNode;
}

/** The policy one clip page gets from a mode. */
export function policyFor(mode: FeedMode | undefined, index: number): ClipPolicy | undefined {
  if (!mode) return undefined;
  const { onDoubleTap } = mode;
  return {
    onDoubleTap: onDoubleTap ? (x, y) => onDoubleTap(index, { x, y }) : undefined,
    noHold: mode.noHold,
    noTapPause: mode.noTapPause,
    lockControls: mode.lockControls,
  };
}

/**
 * The phone feed's stage in a page of `width` × `height`: the whole page, or
 * on wide screens (iPad, a browser) ClipItem's centred 9:16 card with the
 * rail (64 pt, 14 pt off) beside it.
 */
export function phoneStageRect(width: number, height: number, wide: boolean, cardTop: number): StageRect {
  if (!wide) return { x: 0, y: 0, w: width, h: height };
  const h = height - cardTop - 14;
  const w = Math.round((h * 9) / 16);
  return { x: Math.round((width - (w + 14 + 64)) / 2), y: cardTop, w, h };
}
