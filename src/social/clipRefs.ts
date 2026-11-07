import type { Clip } from '@/data/clips';

/** Clip ids are `clip-<index>`: the index is the clip's position in the feed. */
export function clipIndex(id: string): number {
  const n = Number(id.slice('clip-'.length));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Stand-in repost count (clips carry no repost count of their own). */
export function baseReposts(clip: Clip): number {
  return Math.round(clip.shares * 0.45 + (clip.likes % 97));
}
