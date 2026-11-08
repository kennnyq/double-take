/**
 * In-memory social state for the signed-in user. Pure (no React Native
 * runtime imports) so it can be unit-tested with `node --test`.
 */
import type { Clip } from '../data/clips.ts';
import { clipKey } from './clipRefs.ts';

/** Lists of clips, newest first. */
export type ClipListKind = 'liked' | 'saved' | 'reposted' | 'sent';

/**
 * A snapshot of the clip at the time you acted on it. Profile tiles render
 * from this, since a clip can't be rebuilt reliably from its id.
 */
export interface ClipEntry {
  /** The clip's stable key (`clipKey`). */
  id: string;
  clip: Clip;
  at: number;
}

export interface MyComment {
  id: string;
  /** The clip's stable key (`clipKey`). */
  clipId: string;
  text: string;
  /** Top-level comment this replies to, or null for a top-level comment. */
  parentId: string | null;
  createdAt: number;
}

export interface SocialState {
  liked: ClipEntry[];
  saved: ClipEntry[];
  reposted: ClipEntry[];
  sent: ClipEntry[];
  /** Author handles. */
  followed: string[];
  /** Your comments per clip key, newest first. */
  comments: Record<string, MyComment[]>;
  /** Comment ids (stand-in or yours) you've liked. */
  likedComments: Record<string, true>;
}

export type SocialAction =
  | { type: 'toggle'; kind: ClipListKind; clip: Clip; on?: boolean; at: number }
  /** Records a send; re-sending moves the clip back to the front of `sent`. */
  | { type: 'sent'; clip: Clip; at: number }
  | { type: 'follow'; author: string; on?: boolean }
  | { type: 'comment'; comment: MyComment }
  | { type: 'likeComment'; id: string; on?: boolean };

export const initialSocialState: SocialState = {
  liked: [],
  saved: [],
  reposted: [],
  sent: [],
  followed: [],
  comments: {},
  likedComments: {},
};

export const hasClip = (list: ClipEntry[], id: string) => list.some((e) => e.id === id);

export function socialReducer(state: SocialState, action: SocialAction): SocialState {
  switch (action.type) {
    case 'toggle': {
      const list = state[action.kind];
      const id = clipKey(action.clip);
      const has = hasClip(list, id);
      const on = action.on ?? !has;
      if (on === has) return state;
      return {
        ...state,
        [action.kind]: on ? [{ id, clip: action.clip, at: action.at }, ...list] : list.filter((e) => e.id !== id),
      };
    }
    case 'sent': {
      const id = clipKey(action.clip);
      return { ...state, sent: [{ id, clip: action.clip, at: action.at }, ...state.sent.filter((e) => e.id !== id)] };
    }
    case 'follow': {
      const has = state.followed.includes(action.author);
      const on = action.on ?? !has;
      if (on === has) return state;
      return {
        ...state,
        followed: on ? [action.author, ...state.followed] : state.followed.filter((a) => a !== action.author),
      };
    }
    case 'comment': {
      const { clipId } = action.comment;
      return {
        ...state,
        comments: { ...state.comments, [clipId]: [action.comment, ...(state.comments[clipId] ?? [])] },
      };
    }
    case 'likeComment': {
      const has = !!state.likedComments[action.id];
      const on = action.on ?? !has;
      if (on === has) return state;
      const likedComments = { ...state.likedComments };
      if (on) likedComments[action.id] = true;
      else delete likedComments[action.id];
      return { ...state, likedComments };
    }
  }
}
