import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import type { Clip } from '@/data/clips';
import { formatAgo, makeComments, makeReplies, type StandInComment } from '@/data/comments';
import { useSocialActions } from '@/social/actions';
import { clipKey } from '@/social/clipRefs';
import { useAuth, useMe } from '@/auth/store';
import { supabase } from '@/auth/supabase';
import type { MyComment } from '@/social/reducer';
import { fetchPublicComments, type PublicComment } from '@/social/sync';
import { useSocial } from '@/social/store';
import { CommentRow, MoreReplies, type DisplayComment } from './CommentRow';
import { Composer } from './Composer';

type Row =
  | { kind: 'comment'; key: string; c: DisplayComment }
  | { kind: 'more'; key: string; threadId: string; count: number; expanded: boolean };

const EMPTY: MyComment[] = [];
const NO_OTHERS: PublicComment[] = [];

function fromStandIn(c: StandInComment): DisplayComment {
  return {
    id: c.id,
    handle: c.handle,
    text: c.text,
    time: formatAgo(c.ago),
    likes: c.likes,
    isAuthor: c.isAuthor,
    threadId: c.parentId ?? c.id,
    isReply: c.parentId !== null,
  };
}

function fromMine(c: MyComment | PublicComment, handle: string, author: string): DisplayComment {
  return {
    id: c.id,
    handle,
    text: c.text,
    time: formatAgo((Date.now() - c.createdAt) / 60_000),
    likes: 0,
    isAuthor: handle === author,
    threadId: c.parentId ?? c.id,
    isReply: c.parentId !== null,
  };
}

/** Other members' comments on a saved clip, loaded when the comments open. */
function usePublicComments(key: string, saved: boolean): PublicComment[] {
  const { status, session } = useAuth();
  const uid = status === 'member' ? (session?.user.id ?? null) : null;
  const [list, setList] = useState(NO_OTHERS);
  useEffect(() => {
    if (!supabase || !saved || status === 'loading') return;
    let live = true;
    fetchPublicComments(supabase, key, uid)
      .then((l) => live && setList(l))
      .catch((e) => console.warn(`[comments] ${e instanceof Error ? e.message : e}`));
    return () => {
      live = false;
    };
  }, [key, saved, uid, status]);
  return list;
}

/** The clip's comment count: its own, other members' and yours. */
export function useCommentTotal(clip: Clip): number {
  const social = useSocial();
  const key = clipKey(clip);
  return clip.comments + (social.stats[key]?.comments ?? 0) + (social.comments[key]?.length ?? 0);
}

interface Props {
  clip: Clip;
  /** Space under the composer (safe area; 0 while the keyboard is up). */
  bottomInset: number;
  /**
   * Desktop panel: no quick-emoji row, Enter posts (Shift+Enter for a new
   * line) and the input keeps focus after posting.
   */
  desktop?: boolean;
}

/**
 * A clip's comments and the composer under them, without any chrome: the
 * phone's bottom sheet and the desktop's side panel each wrap it in their own.
 */
export function CommentsThread({ clip, bottomInset, desktop = false }: Props) {
  const clipId = clipKey(clip);
  const standIn = useMemo(() => makeComments(clip), [clip]);
  const social = useSocial();
  const mine = social.comments[clipId] ?? EMPTY;
  const me = useMe();
  const others = usePublicComments(clipId, clip.sourceId !== undefined);
  const actions = useSocialActions();

  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ threadId: string; handle: string } | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const own = (c: MyComment | PublicComment) => fromMine(c, 'handle' in c ? c.handle : me.handle, clip.author);
    // Yours and other members', newest first; replies oldest first within a thread.
    const all = [...mine, ...others].sort((a, b) => b.createdAt - a.createdAt);
    const myTop = all.filter((c) => c.parentId === null);
    const myReplies = all.filter((c) => c.parentId !== null).reverse();
    const pushThread = (top: DisplayComment, replyCount: number, source?: StandInComment) => {
      out.push({ kind: 'comment', key: top.id, c: top });
      for (const r of myReplies) {
        if (r.parentId === top.id) out.push({ kind: 'comment', key: r.id, c: own(r) });
      }
      if (replyCount > 0 && source) {
        const isOpen = !!expanded[top.id];
        if (isOpen) {
          for (const r of makeReplies(source, clip.author)) out.push({ kind: 'comment', key: r.id, c: fromStandIn(r) });
        }
        out.push({ kind: 'more', key: `${top.id}-more`, threadId: top.id, count: replyCount, expanded: isOpen });
      }
    };
    for (const c of myTop) pushThread(own(c), 0);
    for (const c of standIn) pushThread(fromStandIn(c), c.replyCount, c);
    return out;
  }, [mine, others, me.handle, standIn, expanded, clip.author]);

  const toggleThread = useCallback(
    (threadId: string) =>
      setExpanded((e) => {
        const n = { ...e };
        if (n[threadId]) delete n[threadId];
        else n[threadId] = true;
        return n;
      }),
    [],
  );

  const onReply = useCallback((c: DisplayComment) => {
    setReplyTo({ threadId: c.threadId, handle: c.handle });
    setText(`@${c.handle} `);
    inputRef.current?.focus();
  }, []);

  const onLike = useCallback((id: string) => actions.likeComment(id), [actions]);

  const post = () => {
    const t = text.trim();
    if (!t) return;
    actions.postComment(clipId, t, replyTo?.threadId ?? null);
    setText('');
    setReplyTo(null);
    if (!desktop) Keyboard.dismiss();
    if (!replyTo) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  return (
    <View style={styles.fill}>
      <FlatList
        ref={listRef}
        style={styles.fill}
        data={rows}
        keyExtractor={(r) => r.key}
        extraData={social.likedComments}
        renderItem={({ item }) =>
          item.kind === 'comment' ? (
            <CommentRow c={item.c} liked={!!social.likedComments[item.c.id]} onLike={onLike} onReply={onReply} />
          ) : (
            <MoreReplies count={item.count} expanded={item.expanded} onPress={() => toggleThread(item.threadId)} />
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No comments yet</Text>
            <Text style={styles.emptyText}>Start the conversation.</Text>
          </View>
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.listContent, rows.length === 0 && styles.fillGrow]}
        initialNumToRender={12}
      />
      <Composer
        inputRef={inputRef}
        value={text}
        onChange={setText}
        onPost={post}
        placeholder={desktop ? 'Add a comment…' : `Add a comment for ${clip.author}…`}
        replyingTo={replyTo?.handle ?? null}
        onCancelReply={() => {
          setReplyTo(null);
          setText('');
        }}
        bottomInset={bottomInset}
        desktop={desktop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  fillGrow: { flexGrow: 1 },
  listContent: { paddingVertical: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 48 },
  emptyTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  emptyText: { color: '#a8a8a8', fontSize: 13 },
});
