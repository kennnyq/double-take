/**
 * The timed round's rules in one place, so they can change without hunting
 * through the screens. Pure (no React Native), so the reducer and its tests
 * read the same numbers.
 */
/** The Game tab's name (the untimed game). One place, so it can be renamed. */
export const GAME_TAB_LABEL = 'Game';

export const GAME = {
  /** How long a round lasts. Dev builds can shorten it (Dev settings → Game). */
  roundMs: 60_000,
  /** The 3-2-1 before a round starts, and again after a pause. */
  countdownMs: 3_000,
  /** At most this many clips in a round's deck. */
  deckCap: 60,
  /** Clips from this many previous rounds are used only once the fresh ones run out. */
  recentRounds: 2,
  /** A production build offers the round only with at least this many clips of each kind. */
  minPerKind: 8,
  /** After marking a clip AI, the stamp shows this long before the next clip slides in. */
  markAdvanceMs: 300,
  /** The timer bar turns to the warning colour over this last stretch. */
  warnMs: 10_000,
  /** Round summaries kept on the device. */
  historyLimit: 20,
} as const;

/**
 * Points per decision. Skipping counts as calling the clip real (there's no
 * separate gesture for it), so skipping an AI clip is a miss.
 */
export const POINTS = {
  /** Marked an AI clip AI. */
  hit: 1,
  /** Marked a real clip AI. */
  falseAlarm: -1,
  /** Skipped a real clip: no points, but it counts toward accuracy. */
  correctSkip: 0,
  /** Skipped an AI clip. */
  miss: 0,
  /** The total never goes below this. */
  floor: 0,
} as const;
