import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { Avatar } from '@/ui/Avatar';
import { NOTE_MAX } from './noteText';
import { setMyNote } from './note';

/**
 * Editing your profile note, like Instagram's: the bubble over your avatar,
 * typed into directly. Done saves; an empty note clears it. Fades in and out.
 */
export function NoteEditor({ open, note, handle, onClose }: { open: boolean; note: string | null; handle: string; onClose: () => void }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* Mounted while open, so each opening starts from the saved note. */}
      {open && <Editor note={note} handle={handle} onClose={onClose} />}
    </Modal>
  );
}

function Editor({ note, handle, onClose }: { note: string | null; handle: string; onClose: () => void }) {
  const [text, setText] = useState(note ?? '');
  const input = useRef<TextInputInstance>(null);
  const left = NOTE_MAX - Array.from(text).length;

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const done = () => {
    onClose();
    if (text.trim() !== (note ?? '')) setMyNote(text);
  };

  return (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close note" />
      <View style={styles.card} role="dialog" aria-label="Note" accessibilityViewIsModal>
        <View style={styles.bubble}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={(t) => setText(Array.from(t).slice(0, NOTE_MAX).join(''))}
            onSubmitEditing={done}
            placeholder="Share a thought…"
            placeholderTextColor="#8e8e8e"
            style={styles.input}
            maxLength={NOTE_MAX * 2}
            returnKeyType="done"
            blurOnSubmit
            keyboardAppearance="dark"
            accessibilityLabel="Note"
          />
        </View>
        <View style={styles.tail} />
        <Avatar name={handle} size={64} />
        <Text style={[styles.count, left <= 10 && styles.countLow]}>{left}</Text>
        <Pressable onPress={done} style={({ pressed }) => [styles.done, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.7)' },
  card: { width: '100%', maxWidth: 340, alignItems: 'center', gap: 12 },
  bubble: {
    alignSelf: 'stretch',
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#2a2a2a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  // The bubble's little tail, pointing at the avatar.
  tail: { width: 12, height: 12, borderRadius: 6, marginTop: -8, backgroundColor: '#2a2a2a' },
  input: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 12,
    // The bubble is the field; no browser focus box inside it.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  count: { marginTop: 2, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontVariant: ['tabular-nums'] },
  countLow: { color: '#ffb340' },
  done: { height: 44, paddingHorizontal: 28, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3a3a3c' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
