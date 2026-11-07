import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCount } from '@/data/clips';
import { Avatar } from '@/ui/Avatar';

export interface DisplayComment {
  id: string;
  handle: string;
  text: string;
  time: string;
  likes: number;
  isAuthor: boolean;
  /** Top-level id this belongs under (itself for top-level comments). */
  threadId: string;
  isReply: boolean;
}

interface RowProps {
  c: DisplayComment;
  liked: boolean;
  onLike: (id: string) => void;
  onReply: (c: DisplayComment) => void;
}

export const CommentRow = memo(function CommentRow({ c, liked, onLike, onReply }: RowProps) {
  const likes = c.likes + (liked ? 1 : 0);
  return (
    <View style={[styles.row, c.isReply && styles.replyRow]}>
      <Avatar name={c.handle} size={c.isReply ? 26 : 34} />
      <View style={styles.body}>
        <View style={styles.meta}>
          <Text style={styles.handle} numberOfLines={1}>
            {c.handle}
          </Text>
          <Text style={styles.time}>{c.time}</Text>
          {c.isAuthor && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Author</Text>
            </View>
          )}
        </View>
        <Text style={styles.text}>{c.text}</Text>
        <Pressable onPress={() => onReply(c)} hitSlop={8} accessibilityRole="button" style={styles.replyBtn}>
          {({ pressed }) => <Text style={[styles.reply, pressed && { opacity: 0.5 }]}>Reply</Text>}
        </Pressable>
      </View>
      <Pressable
        onPress={() => onLike(c.id)}
        hitSlop={10}
        style={styles.like}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Unlike comment' : 'Like comment'}
        accessibilityState={{ selected: liked }}
      >
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? '#ff3040' : '#a8a8a8'} />
        {likes > 0 && <Text style={styles.likeCount}>{formatCount(likes)}</Text>}
      </Pressable>
    </View>
  );
});

export function MoreReplies({ count, expanded, onPress }: { count: number; expanded: boolean; onPress: () => void }) {
  const label = expanded ? 'Hide replies' : `View ${count} more ${count === 1 ? 'reply' : 'replies'}`;
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.more} accessibilityRole="button">
      {({ pressed }) => (
        <>
          <View style={styles.moreLine} />
          <Text style={[styles.moreText, pressed && { opacity: 0.5 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  replyRow: { paddingLeft: 62 },
  body: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handle: { color: '#f5f5f5', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  time: { color: '#8e8e8e', fontSize: 12 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  badgeText: { color: '#d0d0d0', fontSize: 11, fontWeight: '600' },
  text: { color: '#f5f5f5', fontSize: 14, lineHeight: 19 },
  replyBtn: { alignSelf: 'flex-start', marginTop: 3 },
  reply: { color: '#a8a8a8', fontSize: 12, fontWeight: '600' },
  like: { alignItems: 'center', width: 36, paddingTop: 4, gap: 2 },
  likeCount: { color: '#a8a8a8', fontSize: 11 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 62, paddingVertical: 6 },
  moreLine: { width: 24, height: StyleSheet.hairlineWidth, backgroundColor: '#8e8e8e' },
  moreText: { color: '#a8a8a8', fontSize: 12, fontWeight: '600' },
});
