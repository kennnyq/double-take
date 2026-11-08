import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { usePalette } from '@/ui/theme';
import { ProgressRing } from './hud/ProgressRing';
import { NATIVE, lerp, useEased } from './motion';

const RING = 72;

/**
 * Where a press may become the hold that marks a clip AI: a ring that fills
 * around the finger (or the middle of the clip, for Space) over the hold, as
 * the gesture hint's ring does, and fades away when the press lets go or the
 * hold lands. Only transform and opacity move.
 */
export function PressRing({ x, y, holdMs, holding }: { x: number; y: number; holdMs: number; holding: boolean }) {
  const c = usePalette();
  const [fill] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(fill, { toValue: 1, duration: holdMs, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [fill, holdMs]);
  const shown = useEased(holding ? 1 : 0, holding ? 160 : 260);
  return (
    <Animated.View
      pointerEvents="none"
      testID="press-ring"
      style={[styles.ring, { left: x - RING / 2, top: y - RING / 2, opacity: shown, transform: [{ scale: lerp(shown, [0, 1], [0.8, 1]) }] }]}
    >
      <View style={styles.pool} />
      <ProgressRing progress={fill} size={RING} stroke={4} color={c.ai} track="rgba(255,255,255,0.35)" />
    </Animated.View>
  );
}

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
  ring: { position: 'absolute', width: RING, height: RING },
  pool: { position: 'absolute', left: 0, top: 0, width: RING, height: RING, borderRadius: RING / 2, backgroundColor: 'rgba(0,0,0,0.25)' },
  ripple: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 3 },
});
