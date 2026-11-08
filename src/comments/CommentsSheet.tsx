import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Clip } from '@/data/clips';
import { BottomSheet, useKeyboardVisible } from '@/ui/BottomSheet';
import { CommentsThread, useCommentTotal } from './CommentsThread';

interface Props {
  clip: Clip;
  open: boolean;
  progress: Animated.Value;
  onRequestClose: () => void;
  onClosed: () => void;
}

/** The phone's comments: a bottom sheet over the feed. */
export function CommentsSheet({ clip, open, progress, onRequestClose, onClosed }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const total = useCommentTotal(clip);

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
      <CommentsThread clip={clip} bottomInset={keyboard ? 0 : insets.bottom} />
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
});
