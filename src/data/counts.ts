/**
 * Stand-in engagement for clips the source gave no counts for: plausible
 * likes, comments and shares, seeded by the clip's stable id so they never
 * change between loads, and spread like real short-video counts (most clips
 * modest, a few big). Clips with real counts keep them. Pure, for `node --test`.
 */

/** FNV-1a: a stable 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Counts {
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Likes from about 200 to about 400K, skewed low (log-uniform, squeezed
 * toward the bottom), then comments at 0.4–2% and shares at 0.8–5% of likes.
 */
export function standInCounts(seed: string): Counts {
  const r = rng(hashString(seed));
  const likes = Math.round(10 ** (2.3 + 3.3 * r() ** 1.4));
  return {
    likes,
    comments: Math.round(likes * (0.004 + 0.016 * r())),
    shares: Math.round(likes * (0.008 + 0.042 * r())),
  };
}

/** The source's counts, or stand-ins when it has none (no likes reported). */
export function countsFor(seed: string, likes: number | null | undefined): Counts {
  const real = Math.max(0, Math.round(likes ?? 0));
  if (real > 0) return { likes: real, comments: Math.round(real * 0.012), shares: Math.round(real * 0.03) };
  return standInCounts(seed);
}
