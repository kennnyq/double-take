import { useEffect } from 'react';
import { Easing, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { holeFor, type Rect, type SpotlightShape } from './spotlight';

/** Fading the spotlight out, and back in. */
const FADE_OUT_MS = 180;
const FADE_IN_MS = 320;

export interface SpotlightMotion {
  /** The hole's rectangle (stage px). */
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  /** 0: no spotlight, 1: on the area. */
  on: SharedValue<number>;
}

/**
 * The spotlight only fades: in on an area, out when there is none, and from
 * one area to the next by fading out, moving while it's invisible, and fading
 * back in (no sliding, no closing in from the edges). A change mid-fade
 * carries on from the current opacity. Everything runs on the UI thread.
 */
export function useSpotlightMotion(area: Rect | null, shape: SpotlightShape, pad?: number): SpotlightMotion {
  const target = area ? holeFor(area, shape, pad) : null;
  const x = useSharedValue(target?.x ?? 0);
  const y = useSharedValue(target?.y ?? 0);
  const w = useSharedValue(target?.w ?? 100);
  const h = useSharedValue(target?.h ?? 100);
  const on = useSharedValue(0);
  const key = target ? [target.x, target.y, target.w, target.h].map(Math.round).join() : '';

  useEffect(() => {
    const out = { duration: FADE_OUT_MS, easing: Easing.out(Easing.quad) };
    const fadeIn = { duration: FADE_IN_MS, easing: Easing.out(Easing.cubic) };
    if (!target) {
      on.value = withTiming(0, out);
      return;
    }
    const place = (sv: SharedValue<number>, v: number, after: number) => {
      sv.value = after ? withDelay(after, withTiming(v, { duration: 0 })) : v;
    };
    // Already (nearly) invisible: move there now and fade in. Else fade out first.
    const wait = on.value < 0.05 ? 0 : Math.round(FADE_OUT_MS * on.value);
    place(x, target.x, wait);
    place(y, target.y, wait);
    place(w, target.w, wait);
    place(h, target.h, wait);
    on.value = wait ? withSequence(withTiming(0, { ...out, duration: wait }), withTiming(1, fadeIn)) : withTiming(1, fadeIn);
    // `key` stands for the target's numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { x, y, w, h, on };
}
