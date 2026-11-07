/**
 * The landing's launch hands its sound setting to the feed once the feed's
 * own video has taken over from the one that grew.
 */
export interface Handoff {
  muted: boolean;
}

let receiver: ((h: Handoff) => void) | null = null;

/** The feed listens while it is mounted. */
export function receiveHandoff(fn: (h: Handoff) => void) {
  receiver = fn;
  return () => {
    if (receiver === fn) receiver = null;
  };
}

export function sendHandoff(h: Handoff) {
  receiver?.(h);
}
