import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Keyboard, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Clip } from '@/data/clips';
import { formatAgo, makeComments, makeReplies, type StandInComment } from '@/data/comments';
import { useSocialActions } from '@/social/actions';
import { clipKey } from '@/social/clipRefs';
import { ME } from '@/social/me';
import type { MyComment } from '@/social/reducer';
import { useSocial } from '@/social/store';
import { BottomSheet, useKeyboardVisible } from '@/ui/BottomSheet';
import { CommentRow, MoreReplies, type DisplayComment } from './CommentRow';
import { Composer } from './Composer';

type Row =
  | { kind: 'comment'; key: string; c: DisplayComment }
  | { kind: 'more'; key: string; threadId: string; count: number; expanded: boolean };

const EMPTY: MyComment[] = [];

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

function fromMine(c: MyComment, author: string): DisplayComment {
  return {
    id: c.id,
    handle: ME.handle,
    text: c.text,
    time: 'now',
    likes: 0,
    isAuthor: ME.handle === author,
    threadId: c.parentId ?? c.id,
    isReply: c.parentId !== null,
  };
}

interface Props {
  clip: Clip;
  open: boolean;
  progress: Animated.Value;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function CommentsSheet({ clip, open, progress, onRequestClose, onClosed }: Props) {
  const clipId = clipKey(clip);
  const standIn = useMemo(() => makeComments(clip), [clip]);
  const social = useSocial();
  const mine = social.comments[clipId] ?? EMPTY;
  const actions = useSocialActions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();

  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ threadId: string; handle: string } | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const myTop = mine.filter((c) => c.parentId === null);
    const myReplies = mine.filter((c) => c.parentId !== null).reverse(); // oldest first within a thread
    const pushThread = (top: DisplayComment, replyCount: number, source?: StandInComment) => {
      out.push({ kind: 'comment', key: top.id, c: top });
      for (const r of myReplies) {
        if (r.parentId === top.id) out.push({ kind: 'comment', key: r.id, c: fromMine(r, clip.author) });
      }
      if (replyCount > 0 && source) {
        const isOpen = !!expanded[top.id];
        if (isOpen) {
          for (const r of makeReplies(source, clip.author)) out.push({ kind: 'comment', key: r.id, c: fromStandIn(r) });
        }
        out.push({ kind: 'more', key: `${top.id}-more`, threadId: top.id, count: replyCount, expanded: isOpen });
      }
    };
    for (const c of myTop) pushThread(fromMine(c, clip.author), 0);
    for (const c of standIn) pushThread(fromStandIn(c), c.replyCount, c);
    return out;
  }, [mine, standIn, expanded, clip.author]);

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
    Keyboard.dismiss();
    if (!replyTo) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const total = clip.comments + mine.length;

  return (
    <BottomSheet
      open={open}
      progress={progress}
      onRequestClose={onRequestClose}
      onClosed={onClosed}
      accessibilityLabel="Comments"
      header={
        <View style={styles.header}>
          <Text style={styles.title}>Comments</Text>
          <Text style={styles.count}>
            {total.toLocaleString('en-US')} {total === 1 ? 'comment' : 'comments'}
          </Text>
        </View>
      }
    >
      <FlatList
        ref={listRef}
        style={styles.list}
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
      />
      <Composer
        inputRef={inputRef}
        value={text}
        onChange={setText}
        onPost={post}
        placeholder={`Add a comment for ${clip.author}…`}
        replyingTo={replyTo?.handle ?? null}
        onCancelReply={() => {
          setReplyTo(null);
          setText('');
        }}
        bottomInset={keyboard ? 0 : insets.bottom}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  count: { color: '#8e8e8e', fontSize: 12, marginTop: 2 },
  list: { flex: 1 },
  listContent: { paddingVertical: 6 },
});
