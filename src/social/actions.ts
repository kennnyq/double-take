import { useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import type { Clip } from '@/data/clips';
import { useToast } from '@/ui/Toast';
import { useAppNav } from './nav';
import { clipKey } from './clipRefs';
import { hasClip, type ClipListKind } from './reducer';
import { useSocialStore } from './store';

let commentSeq = 0;

/**
 * Social actions with their side effects (haptics, toasts). The returned
 * object is stable, so it's safe to hand to memoized feed items. Clip actions
 * take the whole `Clip` so the store can keep a snapshot for the profile grid.
 */
export function useSocialActions() {
  const store = useSocialStore();
  const toast = useToast();
  const nav = useAppNav();

  return useMemo(() => {
    const has = (kind: ClipListKind, id: string) => hasClip(store.getState()[kind], id);
    const set = (kind: ClipListKind, clip: Clip, on: boolean) =>
      store.dispatch({ type: 'toggle', kind, clip, on, at: Date.now() });

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
      /** Double-tap: always likes, never unlikes. */
      like(clip: Clip) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        set('liked', clip, true);
      },
      toggleLike(clip: Clip) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        set('liked', clip, !has('liked', clipKey(clip)));
      },
      toggleSave(clip: Clip) {
        Haptics.selectionAsync();
        const on = !has('saved', clipKey(clip));
        set('saved', clip, on);
        toast.show(
          on
            ? { icon: 'bookmark', text: 'Saved', action: { label: 'View', onPress: () => nav.openProfile('saved') } }
            : { icon: 'checkmark-circle-outline', text: 'Removed from saved' },
        );
      },
      toggleRepost(clip: Clip) {
        Haptics.selectionAsync();
        setRepost(clip, !has('reposted', clipKey(clip)), true);
      },
      toggleFollow(author: string) {
        Haptics.selectionAsync();
        store.dispatch({ type: 'follow', author });
      },
      markSent(clip: Clip, people: number) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        store.dispatch({ type: 'sent', clip, at: Date.now() });
        toast.show({ icon: 'paper-plane', text: people > 1 ? `Sent to ${people} people` : 'Sent' });
      },
      likeComment(commentId: string) {
        Haptics.selectionAsync();
        store.dispatch({ type: 'likeComment', id: commentId });
      },
      postComment(clipId: string, text: string, parentId: string | null) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        store.dispatch({
          type: 'comment',
          comment: { id: `me-${Date.now()}-${++commentSeq}`, clipId, text, parentId, createdAt: Date.now() },
        });
      },
    };
  }, [store, toast, nav]);
}

export type SocialActions = ReturnType<typeof useSocialActions>;
