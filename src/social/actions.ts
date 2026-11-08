import { useMemo } from 'react';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { requireAccount } from '@/auth/gate';
import type { Clip } from '@/data/clips';
import { useToast } from '@/ui/Toast';
import { clipKey, isPersistable } from './clipRefs';
import { useAppNav } from './nav';
import { persist, persisting } from './persist';
import { hasClip, type ClipListKind } from './reducer';
import { useSocialStore } from './store';

let commentSeq = 0;

/** Stand-in comments on placeholder clips are positional, so likes on them aren't saved. */
const persistableRef = (ref: string) => !ref.startsWith('clip-');

/**
 * Social actions with their side effects (haptics, toasts). The returned
 * object is stable, so it's safe to hand to memoized feed items. Clip actions
 * take the whole `Clip` so the store can keep a snapshot for the profile grid.
 *
 * Every action is a write, so guests are asked to sign in first (the action
 * then runs by itself). Members see the change at once; it's saved in the
 * background and undone with a toast if saving fails.
 */
export function useSocialActions() {
  const store = useSocialStore();
  const toast = useToast();
  const nav = useAppNav();

  return useMemo(() => {
    const has = (kind: ClipListKind, clip: Clip) => hasClip(store.getState()[kind], clipKey(clip));
    const failed = () => toast.show({ icon: 'cloud-offline-outline', text: "Couldn't save. Check your connection." });

    /** Set a clip list entry, save it, and undo on failure. */
    const set = (kind: 'liked' | 'saved' | 'reposted', clip: Clip, on: boolean) => {
      const was = has(kind, clip);
      store.dispatch({ type: 'toggle', kind, clip, on, at: Date.now() });
      if (was === on || !isPersistable(clip)) return;
      persist({ kind: 'list', list: kind, key: clipKey(clip), on }, () => {
        store.dispatch({ type: 'toggle', kind, clip, on: was, at: Date.now() });
        failed();
      });
    };

    const setRepost = (clip: Clip, on: boolean, undoable: boolean) => {
      set('reposted', clip, on);
      if (on) {
        toast.show({
          icon: 'repeat',
          text: 'Reposted',
          action: undoable ? { label: 'Undo', onPress: () => setRepost(clip, false, false) } : undefined,
        });
      } else {
        toast.show({ icon: 'repeat', text: 'Removed repost' });
      }
    };

    return {
      /** Double-tap: always likes, never unlikes. Returns false when a guest is asked to sign in instead. */
      like(clip: Clip): boolean {
        return requireAccount('Sign in to like this Take', () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          set('liked', clip, true);
        });
      },
      toggleLike(clip: Clip) {
        requireAccount('Sign in to like this Take', () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          set('liked', clip, !has('liked', clip));
        });
      },
      toggleSave(clip: Clip) {
        requireAccount('Sign in to save Takes for later', () => {
          Haptics.selectionAsync();
          const on = !has('saved', clip);
          set('saved', clip, on);
          toast.show(
            on
              ? { icon: 'bookmark', text: 'Saved', action: { label: 'View', onPress: () => nav.openProfile('saved') } }
              : { icon: 'checkmark-circle-outline', text: 'Removed from saved' },
          );
        });
      },
      toggleRepost(clip: Clip) {
        requireAccount('Sign in to repost this Take', () => {
          Haptics.selectionAsync();
          setRepost(clip, !has('reposted', clip), true);
        });
      },
      toggleFollow(author: string) {
        requireAccount(`Sign in to follow @${author}`, () => {
          Haptics.selectionAsync();
          const on = !store.getState().followed.includes(author);
          store.dispatch({ type: 'follow', author, on });
          persist({ kind: 'follow', author, on }, () => {
            store.dispatch({ type: 'follow', author, on: !on });
            failed();
          });
        });
      },
      markSent(clip: Clip, people: number) {
        requireAccount('Sign in to send Takes to friends', () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const was = has('sent', clip);
          const at = Date.now();
          store.dispatch({ type: 'sent', clip, at });
          toast.show({ icon: 'paper-plane', text: people > 1 ? `Sent to ${people} people` : 'Sent' });
          if (!isPersistable(clip)) return;
          persist({ kind: 'sent', key: clipKey(clip), recipients: Math.max(1, people), at }, () => {
            // A first send is undone; a re-send just keeps its new place.
            if (!was) store.dispatch({ type: 'toggle', kind: 'sent', clip, on: false, at });
            failed();
          });
        });
      },
      likeComment(commentId: string) {
        requireAccount('Sign in to like comments', () => {
          Haptics.selectionAsync();
          const on = !store.getState().likedComments[commentId];
          store.dispatch({ type: 'likeComment', id: commentId, on });
          if (!persistableRef(commentId)) return;
          persist({ kind: 'likeComment', ref: commentId, on }, () => {
            store.dispatch({ type: 'likeComment', id: commentId, on: !on });
            failed();
          });
        });
      },
      /** `clipId` is the clip's key (`clipKey`). */
      postComment(clipId: string, text: string, parentId: string | null) {
        requireAccount('Sign in to comment', () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const saved = persisting() && persistableRef(clipId);
          const comment = {
            // Saved comments get a real uuid up front, so nothing changes after the insert.
            id: saved ? Crypto.randomUUID() : `me-${Date.now()}-${++commentSeq}`,
            clipId,
            text,
            parentId,
            createdAt: Date.now(),
          };
          store.dispatch({ type: 'comment', comment });
          if (!saved) return;
          persist({ kind: 'comment', comment }, () => {
            store.dispatch({ type: 'uncomment', clipId, id: comment.id });
            failed();
          });
        });
      },
    };
  }, [store, toast, nav]);
}

export type SocialActions = ReturnType<typeof useSocialActions>;
