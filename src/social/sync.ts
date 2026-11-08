/**
 * Saving social actions to Supabase and loading them back. The mapping and the
 * write queue are pure (no React Native imports) and run under `node --test`;
 * the I/O helpers take the client as an argument.
 *
 * Writes go straight from the client to Supabase; row level security makes
 * sure each user can only write their own rows (see supabase/migrations).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Clip } from '../data/clips.ts';
import { clipKey } from './clipRefs.ts';
import { initialSocialState, type ClipCounts, type ClipEntry, type MyComment, type SocialState } from './reducer.ts';

// ---- writes ---------------------------------------------------------------------

export type SocialWrite =
  | { kind: 'list'; list: 'liked' | 'saved' | 'reposted'; key: string; on: boolean }
  | { kind: 'sent'; key: string; recipients: number; at: number }
  | { kind: 'follow'; author: string; on: boolean }
  | { kind: 'comment'; comment: MyComment }
  | { kind: 'likeComment'; ref: string; on: boolean };

const LIST_TABLE = { liked: 'likes', saved: 'saves', reposted: 'reposts' } as const;

export type WritePlan =
  | { op: 'upsert'; table: string; values: Record<string, unknown>; onConflict: string; ignoreDuplicates: boolean }
  | { op: 'insert'; table: string; values: Record<string, unknown> }
  | { op: 'delete'; table: string; match: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The row change a write makes for user `uid`. */
export function planWrite(w: SocialWrite, uid: string): WritePlan {
  switch (w.kind) {
    case 'list': {
      const table = LIST_TABLE[w.list];
      return w.on
        ? { op: 'upsert', table, values: { user_id: uid, clip_key: w.key }, onConflict: 'user_id,clip_key', ignoreDuplicates: true }
        : { op: 'delete', table, match: { user_id: uid, clip_key: w.key } };
    }
    case 'sent':
      // Sending again bumps created_at, so the latest send sorts first.
      return {
        op: 'upsert',
        table: 'sends',
        values: {
          user_id: uid,
          clip_key: w.key,
          recipients: Math.min(50, Math.max(1, Math.round(w.recipients))),
          created_at: new Date(w.at).toISOString(),
        },
        onConflict: 'user_id,clip_key',
        ignoreDuplicates: false,
      };
    case 'follow':
      return w.on
        ? {
            op: 'upsert',
            table: 'follows',
            values: { user_id: uid, author_handle: w.author },
            onConflict: 'user_id,author_handle',
            ignoreDuplicates: true,
          }
        : { op: 'delete', table: 'follows', match: { user_id: uid, author_handle: w.author } };
    case 'comment': {
      const { id, clipId, text, parentId, createdAt } = w.comment;
      // A reply to a real comment (a uuid) or to one of the app's stand-ins.
      const real = parentId !== null && UUID.test(parentId);
      return {
        op: 'insert',
        table: 'comments',
        values: {
          id,
          user_id: uid,
          clip_key: clipId,
          parent_id: real ? parentId : null,
          stand_in_parent: parentId !== null && !real ? parentId : null,
          body: text,
          created_at: new Date(createdAt).toISOString(),
        },
      };
    }
    case 'likeComment':
      return w.on
        ? {
            op: 'upsert',
            table: 'comment_likes',
            values: { user_id: uid, comment_ref: w.ref },
            onConflict: 'user_id,comment_ref',
            ignoreDuplicates: true,
          }
        : { op: 'delete', table: 'comment_likes', match: { user_id: uid, comment_ref: w.ref } };
  }
}

/** Writes to the same thing share a slot, so only the latest desired state is sent. */
export function writeSlot(w: SocialWrite): string {
  switch (w.kind) {
    case 'list':
      return `${w.list}:${w.key}`;
    case 'sent':
      return `sent:${w.key}`;
    case 'follow':
      return `follow:${w.author}`;
    case 'comment':
      return `comment:${w.comment.id}`;
    case 'likeComment':
      return `likeComment:${w.ref}`;
  }
}

export async function runPlan(client: SupabaseClient, plan: WritePlan): Promise<void> {
  const q = client.from(plan.table);
  const { error } =
    plan.op === 'upsert'
      ? await q.upsert(plan.values, { onConflict: plan.onConflict, ignoreDuplicates: plan.ignoreDuplicates })
      : plan.op === 'insert'
        ? await q.insert(plan.values)
        : await q.delete().match(plan.match);
  if (error) throw new Error(error.message);
}

/**
 * Serialises writes per slot: while one is in flight, newer writes to the same
 * slot wait, and only the newest of them is sent. A failed write calls
 * `onError` unless a newer write for the slot is already queued (that one
 * decides the final state).
 */
export function createWriteQueue(
  send: (w: SocialWrite) => Promise<void>,
  onError: (w: SocialWrite, e: unknown) => void,
) {
  const inFlight = new Set<string>();
  const waiting = new Map<string, SocialWrite>();

  const run = async (slot: string, w: SocialWrite): Promise<void> => {
    inFlight.add(slot);
    try {
      await send(w);
    } catch (e) {
      if (!waiting.has(slot)) onError(w, e);
    }
    const next = waiting.get(slot);
    waiting.delete(slot);
    if (next) return run(slot, next);
    inFlight.delete(slot);
  };

  return {
    /** Resolves once this slot is idle again. */
    push(w: SocialWrite): Promise<void> {
      const slot = writeSlot(w);
      if (inFlight.has(slot)) {
        waiting.set(slot, w);
        return Promise.resolve();
      }
      return run(slot, w);
    },
    /** Drop queued writes (sign-out). In-flight ones finish on their own. */
    clear() {
      waiting.clear();
    },
  };
}

// ---- reads ------------------------------------------------------------------------

interface KeyRow {
  clip_key: string;
  created_at: string;
}
export interface MineRows {
  likes: KeyRow[];
  saves: KeyRow[];
  reposts: KeyRow[];
  sends: KeyRow[];
  follows: { author_handle: string; created_at: string }[];
  comments: {
    id: string;
    clip_key: string;
    parent_id: string | null;
    stand_in_parent: string | null;
    body: string;
    created_at: string;
  }[];
  commentLikes: { comment_ref: string }[];
}
export interface StatRow {
  clip_key: string;
  likes: number;
  reposts: number;
  comments: number;
}

const time = (iso: string) => Date.parse(iso) || 0;
const newestFirst = <T extends { created_at: string }>(rows: T[]) =>
  rows.slice().sort((a, b) => time(b.created_at) - time(a.created_at));

/** Clips by their stable key, for resolving saved rows back to clips. */
export function clipsByKey(clips: Clip[]): Map<string, Clip> {
  const m = new Map<string, Clip>();
  for (const c of clips) if (!m.has(clipKey(c))) m.set(clipKey(c), c);
  return m;
}

/**
 * Other people's counts per clip: the public totals minus your own share (the
 * app adds yours back from your lists, so it stays right as you toggle).
 */
export function othersCounts(stats: StatRow[], mine?: MineRows | null): Record<string, ClipCounts> {
  const has = (rows: KeyRow[] | undefined, k: string) => !!rows?.some((r) => r.clip_key === k);
  const out: Record<string, ClipCounts> = {};
  for (const s of stats) {
    const myComments = mine ? mine.comments.filter((c) => c.clip_key === s.clip_key).length : 0;
    out[s.clip_key] = {
      likes: Math.max(0, s.likes - (has(mine?.likes, s.clip_key) ? 1 : 0)),
      reposts: Math.max(0, s.reposts - (has(mine?.reposts, s.clip_key) ? 1 : 0)),
      comments: Math.max(0, s.comments - myComments),
    };
  }
  return out;
}

/**
 * Your saved rows as social state. Profile tiles are rebuilt from the clips
 * loaded now (signed media URLs expire, so snapshots aren't stored); rows for
 * clips that aren't in the feed any more are left off the grids.
 */
export function toSocialState(rows: MineRows, clips: Map<string, Clip>, stats: StatRow[] = []): SocialState {
  const entries = (list: KeyRow[]): ClipEntry[] =>
    newestFirst(list).flatMap((r) => {
      const clip = clips.get(r.clip_key);
      return clip ? [{ id: r.clip_key, clip, at: time(r.created_at) }] : [];
    });
  const comments: Record<string, MyComment[]> = {};
  for (const c of newestFirst(rows.comments)) {
    (comments[c.clip_key] ??= []).push({
      id: c.id,
      clipId: c.clip_key,
      text: c.body,
      parentId: c.parent_id ?? c.stand_in_parent,
      createdAt: time(c.created_at),
    });
  }
  const likedComments: Record<string, true> = {};
  for (const l of rows.commentLikes) likedComments[l.comment_ref] = true;
  return {
    ...initialSocialState,
    liked: entries(rows.likes),
    saved: entries(rows.saves),
    reposted: entries(rows.reposts),
    sent: entries(rows.sends),
    followed: newestFirst(rows.follows).map((f) => f.author_handle),
    comments,
    likedComments,
    stats: othersCounts(stats, rows),
  };
}

async function all<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Everything the signed-in user has saved (RLS limits every table to their rows where private). */
export async function fetchMine(client: SupabaseClient, uid: string): Promise<MineRows> {
  const keyed = (table: string) =>
    all<KeyRow>(client.from(table).select('clip_key, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(500));
  const [likes, saves, reposts, sends, follows, comments, commentLikes] = await Promise.all([
    keyed('likes'),
    keyed('saves'),
    keyed('reposts'),
    keyed('sends'),
    all<MineRows['follows'][number]>(client.from('follows').select('author_handle, created_at').eq('user_id', uid).limit(1000)),
    all<MineRows['comments'][number]>(
      client
        .from('comments')
        .select('id, clip_key, parent_id, stand_in_parent, body, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(500),
    ),
    all<MineRows['commentLikes'][number]>(client.from('comment_likes').select('comment_ref').eq('user_id', uid).limit(2000)),
  ]);
  return { likes, saves, reposts, sends, follows, comments, commentLikes };
}

/** Public counts for these clips. */
export async function fetchStats(client: SupabaseClient, keys: string[]): Promise<StatRow[]> {
  if (!keys.length) return [];
  return all<StatRow>(client.from('clip_stats').select('clip_key, likes, reposts, comments').in('clip_key', keys.slice(0, 300)));
}

export interface PublicComment {
  id: string;
  handle: string;
  text: string;
  parentId: string | null;
  createdAt: number;
}

/** Other people's comments on a clip, newest first. */
export async function fetchPublicComments(client: SupabaseClient, key: string, excludeUid: string | null): Promise<PublicComment[]> {
  let q = client
    .from('comments')
    .select('id, user_id, parent_id, stand_in_parent, body, created_at, profiles(handle)')
    .eq('clip_key', key)
    .order('created_at', { ascending: false })
    .limit(200);
  if (excludeUid) q = q.neq('user_id', excludeUid);
  const data = await all<{
    id: string;
    parent_id: string | null;
    stand_in_parent: string | null;
    body: string;
    created_at: string;
    profiles: { handle: string } | { handle: string }[] | null;
  }>(q);
  return data.map((c) => {
    const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    return {
      id: c.id,
      handle: p?.handle ?? 'member',
      text: c.body,
      parentId: c.parent_id ?? c.stand_in_parent,
      createdAt: time(c.created_at),
    };
  });
}
