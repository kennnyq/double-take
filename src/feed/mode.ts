/**
 * Feed modes: the seams that let something else run inside the feed (the
 * timed round today) without a second feed. The phone feed (`Feed`) and the
 * desktop feed (`DesktopFeed`) take an optional `mode`; without one they are
 * the normal feed. A mode can:
 *
 * - give the feed its own clips (a deck) instead of the endless feed;
 * - present each clip through a transform (e.g. strip what would give an
 *   answer away) before the page sees it;
 * - set the interaction policy: where the double take's gesture goes (the
 *   viewer's own: hold, double tap or both; desktop also double-click and
 *   Space), whether a hold plays at 2x or a tap pauses, whether the clip's
 *   social controls are locked (shown, dimmed, out of reach), whether a clip
 *   opens its double take by itself, whether the feed's keyboard shortcuts
 *   apply, and whether the list may scroll right now;
 * - listen to events: the clip the feed came to rest on, the double take's
 *   gesture (and a press that may become its hold), the double take opening
 *   and closing;
 * - draw an overlay (a HUD) over the clip's stage.
 *
 * Everything else (paging, the player pool, audio, preloading, the progress
 * bar) stays the feed's own.
 */
import type { ReactNode } from 'react';
import type { Clip } from '../data/clips.ts';

/** How one clip page behaves (see ClipItem / DesktopFeed's Slide). Every field off by default. */
export interface ClipPolicy {
  /**
   * The double take's gesture, as the viewer set it (hold, double tap or both;
   * desktop: double-click, click and hold, double-tap or hold Space), goes here
   * instead of opening the double take. Not a number where the gesture has no
   * place (Space).
   */
  onReveal?: (x: number, y: number) => void;
  /** A press that may become that hold began (`start`) or let go (`end`), for a ring that fills as it's held. */
  onPress?: (e: PressEvent) => void;
  /** A hold doesn't play at 2x. */
  noHold?: boolean;
  /** A single tap does nothing (no play/pause). */
  noTapPause?: boolean;
  /** The clip's social controls (rail, follow, progress bar) show, dimmed and out of reach. */
  lockControls?: boolean;
  /** The clip opens its double take by itself once it's the active clip (a clip revisited to learn from it). */
  autoReveal?: boolean;
}

export interface PressEvent {
  phase: 'start' | 'end';
  x: number;
  y: number;
  /** How long the press has to be held to count. */
  holdMs: number;
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
  present?: (clip: Clip, index: number) => Clip;
  /** The double take's gesture on the clip at `index` (see `ClipPolicy.onReveal`); replaces opening it. */
  onReveal?: (index: number, at: { x: number; y: number }) => void;
  onPress?: (index: number, e: PressEvent) => void;
  /** Clips that behave as the normal feed's again (their double take opens, by itself too); the rest follow the mode. */
  review?: (index: number) => boolean;
  noHold?: boolean;
  noTapPause?: boolean;
  lockControls?: boolean;
  /** Desktop: the feed's own keys (Space, ←/→ seek, M). Default on. */
  keys?: boolean;
  /** The list may scroll now. Default on. */
  scrollEnabled?: boolean;
  /** The feed came to rest on another clip (a swipe, the wheel, keys, or `goTo`). */
  onActive?: (index: number) => void;
  /** The double take opened or closed. */
  onInspect?: (on: boolean) => void;
  /** Drawn over the feed, given the active clip's stage. */
  overlay?: (stage: StageRect) => ReactNode;
}

/** The policy one clip page gets from a mode. */
export function policyFor(mode: FeedMode | undefined, index: number): ClipPolicy | undefined {
  if (!mode) return undefined;
  if (mode.review?.(index)) return { lockControls: mode.lockControls, autoReveal: true };
  const { onReveal, onPress } = mode;
  return {
    onReveal: onReveal ? (x, y) => onReveal(index, { x, y }) : undefined,
    onPress: onPress ? (e) => onPress(index, e) : undefined,
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
