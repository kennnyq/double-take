import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/ui/Avatar';
import { canAct, openSignIn } from '@/auth/gate';
import { useMe } from '@/auth/store';

const INPUT_MAX_H = 96;
const EMOJI = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

interface Props {
  value: string;
  onChange: (text: string) => void;
  onPost: () => void;
  placeholder: string;
  replyingTo: string | null;
  onCancelReply: () => void;
  bottomInset: number;
  inputRef?: React.Ref<TextInputInstance>;
  /** Desktop: no quick-emoji row (a keyboard has its own), and Enter posts while Shift+Enter adds a line. */
  desktop?: boolean;
}

/** Quick-emoji row + "Add a comment" input with a Post button. */
export function Composer({
  value,
  onChange,
  onPost,
  placeholder,
  replyingTo,
  onCancelReply,
  bottomInset,
  inputRef,
  desktop = false,
}: Props) {
  const canPost = value.trim().length > 0;
  // Web: a browser textarea starts two rows tall and never grows, so start at one
  // row and follow the text (it shrinks back once the comment is posted or cleared).
  const [webH, setWebH] = useState(0);
  const web = Platform.OS === 'web';
  const me = useMe();
  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset + 8 }]}>
      {replyingTo && (
        <View style={styles.replying}>
          <Text style={styles.replyingText} numberOfLines={1}>
            Replying to <Text style={styles.replyingHandle}>@{replyingTo}</Text>
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={18} color="#a8a8a8" />
          </Pressable>
        </View>
      )}
      {!desktop && (
        <View style={styles.emojiRow}>
          {EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => onChange(value + e)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Add ${e}`}
              style={({ pressed }) => [styles.emojiBtn, pressed && { transform: [{ scale: 0.85 }] }]}
            >
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[styles.inputRow, desktop && styles.inputRowDesktop]}>
        <Avatar name={me.handle} size={34} />
        <View style={styles.inputPill}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            onFocus={() => {
              // Guests get sign-in instead of the keyboard.
              if (canAct()) return;
              (inputRef as React.RefObject<TextInputInstance | null> | undefined)?.current?.blur();
              openSignIn('Sign in to comment');
            }}
            placeholder={placeholder}
            onKeyPress={
              desktop
                ? (e) => {
                    // React Native Web hands over the DOM keyboard event.
                    const k = e.nativeEvent as unknown as KeyboardEvent;
                    if (k.key !== 'Enter' || k.shiftKey || k.isComposing) return;
                    (e as unknown as Event).preventDefault();
                    onPost();
                  }
                : undefined
            }
            placeholderTextColor="#8e8e8e"
            style={[styles.input, web && value !== '' && webH > 0 && { height: Math.min(INPUT_MAX_H, webH) }]}
            rows={web ? 1 : undefined}
            onContentSizeChange={web ? (e) => setWebH(e.nativeEvent.contentSize.height) : undefined}
            multiline
            maxLength={500}
            keyboardAppearance="dark"
            accessibilityLabel="Comment"
          />
          <Pressable
            onPress={onPost}
            disabled={!canPost}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPost }}
          >
            {({ pressed }) => (
              <Text style={[styles.post, !canPost && styles.postDisabled, pressed && { opacity: 0.6 }]}>Post</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 6,
    paddingHorizontal: 14,
  },
  replying: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  replyingText: { color: '#a8a8a8', fontSize: 13, flexShrink: 1 },
  replyingHandle: { color: '#f5f5f5', fontWeight: '600' },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 4 },
  emojiBtn: { padding: 2 },
  emoji: { fontSize: 24 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  inputRowDesktop: { paddingTop: 6 },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingLeft: 14,
    paddingRight: 14,
    gap: 8,
  },
  input: { flex: 1, color: '#f5f5f5', fontSize: 15, paddingVertical: 10, maxHeight: INPUT_MAX_H },
  post: { color: '#4c8dff', fontSize: 15, fontWeight: '700' },
  postDisabled: { opacity: 0.4 },
});
