/**
 * What each pooled player should be doing. Pure, so it runs under `node --test`;
 * the phone feed applies it to its expo-video players.
 */

export interface PlaybackState {
  /** The feed is on screen and the app is in the foreground. */
  live: boolean;
  muted: boolean;
  paused: boolean;
  /** Holding the clip: 2x. */
  boost: boolean;
  /** The tells walkthrough replays a stretch slowly, without sound. */
  slowmo: boolean;
  /** The double take is scrubbing (fast-forwarding or rewinding) by seeking: held paused and silent. */
  scrub?: boolean;
}

export interface PlayerPlan {
  play: boolean;
  muted: boolean;
  rate: number;
}

export const BOOST_RATE = 2;

/** Every player but the active one is paused, muted and at normal speed. */
export const IDLE: PlayerPlan = { play: false, muted: true, rate: 1 };

/**
 * The plan for one pooled player. Only the active clip, once its player holds
 * it, may play or make a sound; neighbours preload silently.
 */
export function planFor(isActive: boolean, s: PlaybackState, slowRate: number): PlayerPlan {
  if (!isActive || !s.live) return IDLE;
  // Seeks drive the picture while scrubbing; playing at the same time fights them.
  if (s.scrub) return { play: false, muted: true, rate: s.slowmo ? slowRate : 1 };
  return {
    play: !s.paused,
    muted: s.muted || s.slowmo,
    rate: s.boost ? BOOST_RATE : s.slowmo ? slowRate : 1,
  };
}

/** Pool slots that would be heard: playing and unmuted. Never more than one. */
export function audibleSlots(plans: PlayerPlan[]): number[] {
  return plans.flatMap((p, s) => (p.play && !p.muted ? [s] : []));
}

/** What a player reports now, as far as applying a plan needs. */
export interface PlayerNow {
  muted: boolean;
  rate: number;
}

export type PlayerOp = 'pause' | 'mute' | 'unmute' | 'rate' | 'play';

/**
 * The calls that bring a player to its plan, in order. Only what differs is
 * written, because on iOS every write has side effects: expo-video sets
 * `AVPlayer.rate` when `playbackRate` is set, which starts playback, and each
 * mute or play-state change makes it reconfigure the app's audio session.
 *
 * - Stopping pauses first, then mutes, and never touches the rate (that would
 *   start the player again).
 * - Starting mutes or unmutes first, so nothing is heard at the old setting,
 *   then sets the rate (if it changed) and plays.
 */
export function opsFor(now: PlayerNow, plan: PlayerPlan): PlayerOp[] {
  const ops: PlayerOp[] = [];
  if (!plan.play) {
    ops.push('pause');
    if (plan.muted && !now.muted) ops.push('mute');
    return ops;
  }
  if (plan.muted !== now.muted) ops.push(plan.muted ? 'mute' : 'unmute');
  if (plan.rate !== now.rate) ops.push('rate');
  ops.push('play');
  return ops;
}

/**
 * Corrections for a player whose native state moved on its own: sound or
 * playback the plan doesn't allow. Only ever stops or mutes, so reacting to
 * the player's own events can't start anything or loop.
 */
export function guardOps(now: { muted: boolean; playing: boolean }, plan: PlayerPlan): PlayerOp[] {
  const ops: PlayerOp[] = [];
  if (now.playing && !plan.play) ops.push('pause');
  if (!now.muted && plan.muted) ops.push('mute');
  return ops;
}
