import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { usePalette } from '@/ui/theme';
import { NATIVE, lerp } from './motion';

const RING = 72;

/** A mark's ripple: a ring spreading from where it landed and fading, as a tap's does in the gesture hint. */
export function Ripple({ x, y }: { x: number; y: number }) {
  const c = usePalette();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        { borderColor: c.ai, left: x - RING / 2, top: y - RING / 2, opacity: lerp(t, [0, 0.15, 1], [0, 0.9, 0]), transform: [{ scale: lerp(t, [0, 1], [0.5, 2]) }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ripple: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 3 },
});
