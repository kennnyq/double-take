import { Animated, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function IconButton({ name, onPress, label }: { name: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={name} size={25} color="#fff" style={styles.shadow} />
    </Pressable>
  );
}

/** Floating top bar over the feed: just the sound toggle, top left (Settings is a tab). */
export function TopBar({
  muted,
  onToggleMute,
  opacity,
  hidden,
}: {
  muted: boolean;
  onToggleMute: () => void;
  /** Fades out while a sheet is up (native-driven). */
  opacity?: Animated.AnimatedInterpolation<number>;
  hidden?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      style={[styles.bar, { paddingTop: insets.top + 2 }, opacity && { opacity }]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <IconButton
        name={muted ? 'volume-mute-outline' : 'volume-high-outline'}
        onPress={onToggleMute}
        label={muted ? 'Unmute' : 'Mute'}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 6,
  },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
