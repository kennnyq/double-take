import { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { SIRI } from '@/feed/reveal';

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

/** The double take's card spring (its InfoCard): springy, a little past and back. */
export const CARD_SPRING = { stiffness: 260, damping: 17, mass: 1 } as const;
/** The double take's mode change (inset, chrome): a soft spring with no visible bounce. For geometry. */
export { MODE_SPRING as FIRM_SPRING } from '@/feed/motion';
/** How long text takes to resolve from faint and blurred to sharp: a word's fade in the double take's (Siri) text reveal. */
export const RESOLVE_MS = SIRI.fadeMs;

/** An Animated value that springs to `target` whenever it changes. */
export function useSprung(target: number, spring: { stiffness: number; damping: number; mass: number } = CARD_SPRING): Animated.Value {
  const [v] = useState(() => new Animated.Value(target));
  useEffect(() => {
    const a = Animated.spring(v, { toValue: target, ...spring, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [v, target, spring]);
  return v;
}

/** Browsers: a CSS blur that follows an Animated value (`px` at 1, sharp at 0). Native builds skip it. */
export function blurStyle(v: AnimNum, px: number): object {
  if (Platform.OS !== 'web') return {};
  return { filter: lerp(v, [0, 1], ['blur(0px)', `blur(${px}px)`]) };
}

/** Any animated number: a value, or a node built from one. */
export type AnimNum = Animated.Value | Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication | Animated.AnimatedAddition | Animated.AnimatedSubtraction;

/** `interpolate` on any animated number (their typings don't share one signature). */
export function lerp<T extends number | string>(v: AnimNum, inputRange: number[], outputRange: T[], clamp = true): Animated.AnimatedInterpolation<T> {
  return (v as Animated.Value).interpolate({ inputRange, outputRange: outputRange as never, extrapolate: clamp ? 'clamp' : 'extend' }) as Animated.AnimatedInterpolation<T>;
}
