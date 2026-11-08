import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from './config';
import { NATIVE } from './motion';

interface Props {
  /** Play time left while stopped, ms. */
  remainingMs: number;
  /** While the clock runs: when it runs out (`performance.now()`). The bar drains linearly to it. */
  deadline: number | null;
  durationMs: number;
  /** For the readout, updated by the round's clock. */
  displayMs: number;
  judged: number;
}

/** `m:ss`, rounding up so the readout shows 0:00 only at the end. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The round's clock: a thin full-width bar that drains linearly, easing to
 * the warning colour over the last stretch, with the time left and how many
 * clips were judged beside it.
 */
export function TimerBar({ remainingMs, deadline, durationMs, displayMs, judged }: Props) {
  const [frac] = useState(() => new Animated.Value(remainingMs / durationMs));
  const [width, setWidth] = useState(0);
  const c = usePalette();
  const tint = useTint();

  useEffect(() => {
    const left = deadline === null ? remainingMs : Math.max(0, Math.min(remainingMs, deadline - performance.now()));
    frac.stopAnimation();
    frac.setValue(left / durationMs);
    if (deadline === null || left <= 0) return;
    const a = Animated.timing(frac, { toValue: 0, duration: left, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [frac, remainingMs, deadline, durationMs]);

  const warn = GAME.warnMs / durationMs;
  const translateX = frac.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  // Eases from the bar's colour to the warning colour as the last stretch begins.
  const warnOpacity = frac.interpolate({ inputRange: [warn * 0.6, warn], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.row}>
      <View style={[styles.track, tint.track]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.fill, tint.fill, { transform: [{ translateX }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, tint.warn, { opacity: warnOpacity }]} />
        </Animated.View>
      </View>
      <Text style={[styles.clock, tint.text]} accessibilityLabel={`${Math.ceil(displayMs / 1000)} seconds left`}>
        {formatClock(displayMs)}
      </Text>
      <View style={styles.count} accessibilityLabel={`${judged} judged`}>
        <Ionicons name="layers-outline" size={14} color={c.textDim} />
        <Text style={[styles.countText, tint.dim]}>{judged}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2 },
  clock: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'right' },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 30 },
  countText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

const useTint = themed((c) => ({
  track: { backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { backgroundColor: c.text },
  warn: { backgroundColor: c.danger },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
