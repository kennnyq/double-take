import { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';

/** The native driver where there is one; browsers animate on the JS side. */
export const NATIVE = Platform.OS !== 'web';

/** How long a veil, card or label takes to fade in or out. */
export const FADE_MS = 280;

/**
 * An Animated value that eases to `target` whenever it changes, from wherever
 * it is (so a change midway turns round smoothly instead of jumping).
 */
export function useEased(target: number, ms: number = FADE_MS): Animated.Value {
  const [v] = useState(() => new Animated.Value(target));
  useEffect(() => {
    const a = Animated.timing(v, { toValue: target, duration: ms, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [v, target, ms]);
  return v;
}
