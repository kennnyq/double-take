import { useEffect } from 'react';
import { useSharedValue, withSpring, withTiming, Easing, type SharedValue } from 'react-native-reanimated';
import { holeFor, mixHole, openHole, type Hole, type Rect, type SpotlightShape } from './spotlight';

/** Moving between areas: quick, settles without a visible bounce. */
export const HOLE_SPRING = { stiffness: 190, damping: 26, mass: 1 };

export interface SpotlightMotion {
  /** The hole's animated geometry (the area's hole, eased between areas). */
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  radius: SharedValue<number>;
  feather: SharedValue<number>;
  /** 0: open (no spotlight, the hole takes in the whole stage), 1: closed on the area. */
  on: SharedValue<number>;
}

/**
 * Springs the spotlight's hole toward the area's (in stage px) and opens it
 * out when there is none. A new area retargets from wherever the hole is.
 */
export function useSpotlightMotion(area: Rect | null, shape: SpotlightShape): SpotlightMotion {
  const target = area ? holeFor(area, shape) : null;
  const x = useSharedValue(target?.x ?? 0);
  const y = useSharedValue(target?.y ?? 0);
  const w = useSharedValue(target?.w ?? 0);
  const h = useSharedValue(target?.h ?? 0);
  const radius = useSharedValue(target?.radius ?? 0);
  const feather = useSharedValue(target?.feather ?? 0);
  const on = useSharedValue(0);
  const key = target ? [target.x, target.y, target.w, target.h, target.radius, target.feather].map(Math.round).join() : '';

  useEffect(() => {
    if (!target) {
      on.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) });
      return;
    }
    // The first area of a showing: start there (the hole closes in from the stage edges), no slide.
    const jumpIn = on.value < 0.02;
    const set = (sv: SharedValue<number>, v: number) => {
      sv.value = jumpIn ? v : withSpring(v, HOLE_SPRING);
    };
    set(x, target.x);
    set(y, target.y);
    set(w, target.w);
    set(h, target.h);
    set(radius, target.radius);
    set(feather, target.feather);
    on.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    // `key` stands for the target's numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { x, y, w, h, radius, feather, on };
}

/** The hole to draw now: the area's hole, opened out by `on` (a worklet). */
export function currentHole(m: SpotlightMotion, ellipse: boolean, stageW: number, stageH: number): Hole {
  'worklet';
  const hole: Hole = { x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value, radius: m.radius.value, feather: m.feather.value, ellipse };
  const t = Math.min(1, Math.max(0, m.on.value));
  if (t >= 1) return hole;
  return mixHole(openHole(stageW, stageH, hole), hole, t);
}
