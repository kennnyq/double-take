import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { themed } from '@/ui/theme';
import { NATIVE } from './motion';

interface Props {
  /** When the countdown ends (`performance.now()`). */
  endAt: number;
  totalMs: number;
  size?: number;
}

const NUMBERS = [3, 2, 1] as const;
const RING = 6;

/**
 * 3-2-1: one ring sweeps continuously round over the whole countdown while
 * each numeral crossfades and scales into the next. Driven by one linear
 * value, so nothing steps.
 */
export function Countdown({ endAt, totalMs, size = 148 }: Props) {
  const [t] = useState(() => new Animated.Value(0));
  const tint = useTint();

  useEffect(() => {
    const left = Math.min(totalMs, Math.max(0, endAt - performance.now()));
    t.setValue(1 - left / totalMs);
    const a = Animated.timing(t, { toValue: 1, duration: left, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t, endAt, totalMs]);

  // The ring: two half rings, each turned into its half of the circle in turn.
  const half = size / 2;
  const rightTurn = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'] });
  const leftTurn = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'] });
  const ring = { width: size, height: size, borderRadius: half, borderWidth: RING };

  return (
    <View style={{ width: size, height: size }} accessibilityRole="timer" accessibilityLabel="Starting">
      <View style={[StyleSheet.absoluteFill, ring, tint.track]} />
      {/* Right half: shows the left half ring as it turns through 0–180°. */}
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <Animated.View style={{ position: 'absolute', left: -half, width: size, height: size, transform: [{ rotate: rightTurn }] }}>
          <View style={[styles.clip, { left: 0, width: half, height: size }]}>
            <View style={[ring, tint.ring]} />
          </View>
        </Animated.View>
      </View>
      {/* Left half: the right half ring, through 180–360°. */}
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <Animated.View style={{ position: 'absolute', left: 0, width: size, height: size, transform: [{ rotate: leftTurn }] }}>
          <View style={[styles.clip, { left: half, width: half, height: size }]}>
            <View style={[ring, tint.ring, { marginLeft: -half }]} />
          </View>
        </Animated.View>
      </View>
      {NUMBERS.map((n, i) => {
        const a = i / 3;
        const b = (i + 1) / 3;
        const edge = 0.08;
        const opacity = t.interpolate({
          inputRange: [a - edge, a + edge * 0.5, b - edge * 0.5, b + edge],
          outputRange: [0, 1, 1, 0],
          extrapolate: 'clamp',
        });
        const scale = t.interpolate({ inputRange: [a - edge, b + edge], outputRange: [1.25, 0.8], extrapolate: 'clamp' });
        return (
          <Animated.Text key={n} style={[styles.number, tint.number, { opacity, transform: [{ scale }] }]}>
            {n}
          </Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  number: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 64,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 148,
  },
});

const useTint = themed((c) => ({
  track: { borderColor: 'rgba(255,255,255,0.16)' },
  ring: { borderColor: c.accent },
  number: { color: c.text },
}));
