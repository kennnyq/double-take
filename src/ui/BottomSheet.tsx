import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetHeight } from '@/feed/shrink';

interface Props {
  /** true slides in, false slides out (then `onClosed`). */
  open: boolean;
  /**
   * 0 = closed, 1 = open. Owned by the screen so the feed can shrink the
   * active video in step with the sheet (including while it's dragged).
   */
  progress: Animated.Value;
  onRequestClose: () => void;
  onClosed: () => void;
  /** Rendered in the draggable area under the grabber. */
  header: React.ReactNode;
  children: React.ReactNode;
  accessibilityLabel: string;
}

/**
 * Bottom sheet at ~62% of the window height that covers the tab bar. Slides in
 * ~280ms ease-out, drag the grabber/header down to dismiss (velocity or >30%
 * travel), or tap the area above it. The keyboard pushes the sheet up and
 * compresses its content so the bottom row stays visible.
 */
export function BottomSheet({ open, progress, onRequestClose, onClosed, header, children, accessibilityLabel }: Props) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const H = sheetHeight(winH);

  useEffect(() => {
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 280 : 220,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) onClosed();
    });
    if (!open) Keyboard.dismiss();
  }, [open, progress, onClosed]);

  // Android back closes the sheet.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onRequestClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          progress.stopAnimation();
          Keyboard.dismiss();
        },
        onPanResponderMove: (_, g) => {
          progress.setValue(Math.min(1, Math.max(0, 1 - g.dy / H)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.vy > 0.9 || g.dy > H * 0.3) onRequestClose();
          else Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
        },
      }),
    [progress, H, onRequestClose],
  );

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [H + 40, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
      {/* The KAV fills the window from y=0, so its padding equals the keyboard height. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <Pressable
          style={[styles.backdrop, { minHeight: insets.top + 56 }]}
          onPress={onRequestClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          style={[styles.sheet, { height: H, transform: [{ translateY }] }]}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
        >
          <View {...pan.panHandlers} style={styles.handleArea}>
            <View style={styles.grabber} />
            {header}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Whether the software keyboard is up (iOS "will" events for a snappier layout). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return visible;
}

export const SHEET_BG = '#1c1c1e';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Grows to fill the space above the sheet; shrinks (to its minHeight) when the keyboard is up.
  backdrop: { flex: 1 },
  dim: { backgroundColor: 'rgba(0,0,0,0.18)' },
  sheet: {
    flexShrink: 1,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  handleArea: { paddingTop: 8, alignItems: 'stretch' },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
  },
});
