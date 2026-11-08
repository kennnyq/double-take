/**
 * A guest's social state as stored on the device: the same rows a member's
 * state loads from Supabase (`MineRows`, keyed by clip key), so it's rebuilt
 * with `toSocialState` against the live feed. Clip snapshots aren't stored:
 * their signed media URLs expire. Pure, for `node --test`.
 */
import type { SocialState } from './reducer.ts';
import type { MineRows } from './sync.ts';

export const EMPTY_ROWS: MineRows = { likes: [], saves: [], reposts: [], sends: [], follows: [], comments: [], commentLikes: [] };

const iso = (ms: number) => new Date(Number.isFinite(ms) ? ms : 0).toISOString();

export function toLocalRows(s: SocialState, now = Date.now()): MineRows {
  const keyed = (list: SocialState['liked']) => list.map((e) => ({ clip_key: e.id, created_at: iso(e.at) }));
  return {
    likes: keyed(s.liked),
    saves: keyed(s.saved),
    reposts: keyed(s.reposted),
    sends: keyed(s.sent),
    // Newest first, so later ones get earlier times.
    follows: s.followed.map((author_handle, i) => ({ author_handle, created_at: iso(now - i) })),
    comments: Object.values(s.comments)
      .flat()
      .map((c) => ({
        id: c.id,
        clip_key: c.clipId,
        parent_id: null,
        stand_in_parent: c.parentId,
        body: c.text,
        created_at: iso(c.createdAt),
      })),
    commentLikes: Object.keys(s.likedComments).map((comment_ref) => ({ comment_ref })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown): v is string => typeof v === 'string';

/** Stored rows back, dropping anything malformed (old or hand-edited storage). */
export function parseLocalRows(raw: string | null | undefined): MineRows {
  let o: unknown;
  try {
    o = JSON.parse(raw ?? 'null');
  } catch {
    return EMPTY_ROWS;
  }
  if (!isObj(o)) return EMPTY_ROWS;
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter(isObj) : []);
  const keyed = (k: string) => list(k).filter((r) => str(r.clip_key) && str(r.created_at)) as unknown as MineRows['likes'];
  return {
    likes: keyed('likes'),
    saves: keyed('saves'),
    reposts: keyed('reposts'),
    sends: keyed('sends'),
    follows: list('follows').filter((r) => str(r.author_handle) && str(r.created_at)) as unknown as MineRows['follows'],
    comments: list('comments')
      .filter((r) => str(r.id) && str(r.clip_key) && str(r.body) && str(r.created_at))
      .map((r) => ({
        id: r.id as string,
        clip_key: r.clip_key as string,
        parent_id: str(r.parent_id) ? r.parent_id : null,
        stand_in_parent: str(r.stand_in_parent) ? r.stand_in_parent : null,
        body: r.body as string,
        created_at: r.created_at as string,
      })),
    commentLikes: list('commentLikes').filter((r) => str(r.comment_ref)) as unknown as MineRows['commentLikes'],
  };
}
