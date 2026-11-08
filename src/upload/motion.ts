import { useEffect, useState } from 'react';
import { Easing, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';

export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/**
 * Eases a shared value to `target` and retargets from wherever it is when the
 * target changes mid-flight, so a step change never restarts or snaps.
 */
export function useEased(target: number, ms = 320, easing = EASE_OUT, delay = 0): SharedValue<number> {
  const v = useSharedValue(target);
  useEffect(() => {
    const t = withTiming(target, { duration: ms, easing });
    v.value = delay > 0 ? withDelay(delay, t) : t;
  }, [target, v, ms, easing, delay]);
  return v;
}

/**
 * Keeps something mounted while it fades out: `mounted` turns true with `on`
 * and back to false `ms` after `on` turns false (unless it came back on).
 */
export function usePresence(on: boolean, ms = 260): [boolean, SharedValue<number>] {
  const [mounted, setMounted] = useState(on);
  if (on && !mounted) setMounted(true);
  const progress = useEased(on ? 1 : 0, ms);
  useEffect(() => {
    if (on) return;
    const t = setTimeout(() => setMounted(false), ms + 40);
    return () => clearTimeout(t);
  }, [on, ms]);
  return [mounted, progress];
}

/**
 * `value`, or for `ms` after it goes away, the last one it had: lets content
 * fade out showing what it showed instead of vanishing the moment its data does.
 */
export function useLatched<T>(value: T | undefined, ms = 420): T | undefined {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  const [mounted] = usePresence(value !== undefined, ms);
  return value ?? (mounted ? last : undefined);
}
