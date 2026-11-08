import { useEffect } from 'react';
import { Easing, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

/** The double take's mode change (inset, chrome fades): a soft spring, no visible bounce. */
export const MODE_SPRING = { stiffness: 210, damping: 28, mass: 1 };

/**
 * A 0..1 value that follows `on` with the mode spring (interruptible: a change
 * mid-way turns around from where it is).
 */
export function useModeProgress(on: boolean): SharedValue<number> {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    t.value = withSpring(on ? 1 : 0, MODE_SPRING);
  }, [on, t]);
  return t;
}

/** Same, eased rather than sprung: for opacity, which must not overshoot. */
export function useFadeProgress(on: boolean, ms = 260): SharedValue<number> {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(on ? 1 : 0, { duration: ms, easing: Easing.out(Easing.cubic) });
  }, [on, t, ms]);
  return t;
}
