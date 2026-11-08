import type { Clip } from '../data/clips.ts';

/** Clip ids are `clip-<index>`: the index is the clip's position in the feed. */
export function clipIndex(id: string): number {
  const n = Number(id.slice('clip-'.length));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Stand-in repost count (clips carry no repost count of their own). */
export function baseReposts(clip: Clip): number {
  return Math.round(clip.shares * 0.45 + (clip.likes % 97));
}

/**
 * A clip's stable key: the media Worker's id (`sourceId`) for remote clips, which
 * survives reloads and feed reshuffles, else the positional `clip-<index>` id
 * (bundled placeholders, which are never saved). Social state is keyed by this.
 */
export function clipKey(clip: Pick<Clip, 'id' | 'sourceId'>): string {
  return clip.sourceId ?? clip.id;
}

/** Only remote clips have a stable identity, so only their actions are saved. */
export function isPersistable(clip: Pick<Clip, 'sourceId'>): boolean {
  return !!clip.sourceId;
}
