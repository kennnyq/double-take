import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { themed } from '@/ui/theme';
import { NATIVE } from './motion';

interface Props {
  /** Where the double tap landed, in the stage. */
  x: number;
  y: number;
  /** The card it was made on, and the pager's position: the stamp leaves with its card. */
  idx: number;
  pos: Animated.Value;
  height: number;
}

const W = 92;
const H = 52;

/** The "AI" stamp a mark leaves: springs in where the tap landed and slides away with its clip. */
export function MarkStamp({ x, y, idx, pos, height }: Props) {
  const [appear] = useState(() => new Animated.Value(0));
  const tint = useTint();
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, stiffness: 420, damping: 20, mass: 0.8, useNativeDriver: NATIVE }).start();
  }, [appear]);
  const follow = useMemo(() => Animated.multiply(Animated.subtract(idx, pos), height), [idx, pos, height]);
  const left = Math.max(8, x - W / 2);
  const top = Math.max(8, y - H / 2);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.stamp,
        tint.stamp,
        {
          left,
          top,
          opacity: appear.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: follow },
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) },
            { rotate: '-10deg' },
          ],
        },
      ]}
    >
      <Text style={[styles.text, tint.text]}>AI</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stamp: {
    position: 'absolute',
    width: W,
    height: H,
    borderRadius: 12,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 28, fontWeight: '900', letterSpacing: 2 },
});

const useTint = themed((c) => ({
  stamp: { backgroundColor: c.ai, borderColor: c.onAi },
  text: { color: c.onAi },
}));
