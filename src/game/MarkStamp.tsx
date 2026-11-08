import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { themed } from '@/ui/theme';
import { CARD_SPRING, NATIVE, lerp, useEased } from './motion';

const W = 92;
const H = 52;

/**
 * The "AI" stamp a mark leaves where the tap landed: springs in (the double
 * take's card spring), and eases away as the feed moves on.
 */
export function MarkStamp({ x, y, leaving = false }: { x: number; y: number; leaving?: boolean }) {
  const [appear] = useState(() => new Animated.Value(0));
  const tint = useTint();
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, ...CARD_SPRING, useNativeDriver: NATIVE }).start();
  }, [appear]);
  // It eases away as its clip moves on (it's drawn over the feed, not inside the clip).
  const out = useEased(leaving ? 0 : 1, 260);
  return (
    <Animated.View
      pointerEvents="none"
      testID="mark-stamp"
      style={[
        styles.stamp,
        tint.stamp,
        {
          left: Math.max(8, x - W / 2),
          top: Math.max(8, y - H / 2),
          opacity: Animated.multiply(lerp(appear, [0, 0.4], [0, 1]), out),
          transform: [{ scale: lerp(appear, [0, 1, 1.2], [1.6, 1, 0.94], false) }, { rotate: '-10deg' }],
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
