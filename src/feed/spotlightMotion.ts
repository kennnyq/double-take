import { useEffect } from 'react';
import { Easing, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { holeFor, type Rect, type SpotlightShape } from './spotlight';

/** Moving between areas: quick, settles without a visible bounce. */
export const HOLE_SPRING = { stiffness: 190, damping: 26, mass: 1 };

export interface SpotlightMotion {
  /** The hole's animated rectangle (stage px), eased between areas. */
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  /** 0: no spotlight, 1: on the area. The hole fades in and out where it is. */
  on: SharedValue<number>;
}

/**
 * Springs the spotlight's hole toward the area's (in stage px) and fades it
 * out when there is none. A new area retargets from wherever the hole is.
 * Everything runs on the UI thread; nothing re-renders while it moves.
 */
export function useSpotlightMotion(area: Rect | null, shape: SpotlightShape): SpotlightMotion {
  const target = area ? holeFor(area, shape) : null;
  const x = useSharedValue(target?.x ?? 0);
  const y = useSharedValue(target?.y ?? 0);
  const w = useSharedValue(target?.w ?? 100);
  const h = useSharedValue(target?.h ?? 100);
  const on = useSharedValue(0);
  const key = target ? [target.x, target.y, target.w, target.h].map(Math.round).join() : '';

  useEffect(() => {
    if (!target) {
      on.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
      return;
    }
    // Off (or nearly): start on the new area and fade in there, rather than sliding in from the last one.
    const jumpIn = on.value < 0.05;
    const set = (sv: SharedValue<number>, v: number) => {
      sv.value = jumpIn ? v : withSpring(v, HOLE_SPRING);
    };
    set(x, target.x);
    set(y, target.y);
    set(w, target.w);
    set(h, target.h);
    on.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    // `key` stands for the target's numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { x, y, w, h, on };
}
