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
