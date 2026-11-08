import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePalette } from '@/ui/theme';
import { useGlass } from './glass';
import { ownLayer } from './layer';

export interface SeekBadgeState {
  /** 1: fast-forward, -1: rewind. */
  dir: 1 | -1;
  /** How many times faster than playback the scrub runs, rounded (e.g. 8). */
  speed: number;
}

/**
 * A small fast-forward / rewind mark, like a DVD player's ("⏩ 8×"), shown
 * while the double take runs a long way to a tell. It fades in and out; the
 * last mark stays drawn while it fades.
 */
export function SeekBadge({ state, top }: { state: SeekBadgeState | null; top: number }) {
  // Keep drawing the last mark while it fades out.
  const [shown, setShown] = useState<SeekBadgeState | null>(state);
  if (state && state !== shown) setShown(state);
  const t = useSharedValue(0);
  const g = useGlass();
  const c = usePalette();
  useEffect(() => {
    t.value = withTiming(state ? 1 : 0, { duration: state ? 140 : 260, easing: Easing.out(Easing.cubic) });
  }, [state, t]);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 0.9 + 0.1 * t.value }] }));
  if (!shown) return null;
  return (
    <Animated.View style={[styles.badge, ownLayer, g.button, { top }, style]} pointerEvents="none" accessibilityElementsHidden>
      <Ionicons name={shown.dir > 0 ? 'play-forward' : 'play-back'} size={14} color={c.text} />
      <Text style={[styles.speed, { color: c.text }]}>{`${shown.speed}×`}</Text>
    </Animated.View>
  );
}

/** The badge for a scrub of `seconds` (signed) taking `ms`, or none for a short one. */
export function seekBadgeFor(seconds: number, ms: number, minSeconds = 1.5): SeekBadgeState | null {
  if (!(ms > 0) || !Number.isFinite(seconds) || Math.abs(seconds) < minSeconds) return null;
  return { dir: seconds > 0 ? 1 : -1, speed: Math.max(2, Math.round(Math.abs(seconds) / (ms / 1000))) };
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 12,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  speed: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
