import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet } from 'react-native';
import type { DesignId } from '../designs';
import { CARD_SPRING, FIRM_SPRING, NATIVE, lerp } from '../motion';
import { ClipView } from './ClipView';
import type { ResultEntry } from './ResultTile';

export type ExpandDesign = DesignId<'expand'>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  design: ExpandDesign;
  entry: ResultEntry;
  /** The tile, in the results screen's coordinates. */
  from: Rect;
  /** The full clip's box: the round's stage. */
  to: Rect;
  toRadius: number;
  /** Set to close: it shrinks back into `from`, then `onClosed`. */
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  top: number;
  bottom: number;
}

const TILE_RADIUS = 12;

/**
 * A results tile opening into the full clip and closing back into it, in one
 * of the trial designs. Morph and Lift move the clip's own box from the tile
 * to the stage (a shared-element move: the tile hides while it's open); Zoom
 * scales it up out of the tile as it fades in, over a dimming page.
 */
export function Expand({ design, entry, from, to, toRadius, closing, onClose, onClosed, top, bottom }: Props) {
  // Morph and Lift animate layout (left/top/size), so they run on the JS side; Zoom only transforms.
  const native = design === 'zoom' && NATIVE;
  const [e] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const spring = (v: Animated.Value, toValue: number, cfg: typeof CARD_SPRING | typeof FIRM_SPRING) =>
      Animated.spring(v, { toValue, ...cfg, useNativeDriver: native, restDisplacementThreshold: 0.002, restSpeedThreshold: 0.02 });
    const liftTo = (toValue: number) => Animated.timing(lift, { toValue, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    let a: Animated.CompositeAnimation;
    if (!closing) a = design === 'lift' ? Animated.sequence([liftTo(1), spring(e, 1, CARD_SPRING)]) : spring(e, 1, design === 'zoom' ? CARD_SPRING : FIRM_SPRING);
    else a = design === 'lift' ? Animated.sequence([spring(e, 0, FIRM_SPRING), liftTo(0)]) : spring(e, 0, FIRM_SPRING);
    a.start(({ finished }) => {
      if (finished && closing) onClosed();
    });
    return () => a.stop();
  }, [closing, design, e, lift, native, onClosed]);

  // Browsers: Esc closes.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  let box: object;
  if (design === 'zoom') {
    const s0 = from.w / to.w;
    box = {
      left: to.x,
      top: to.y,
      width: to.w,
      height: to.h,
      borderRadius: toRadius,
      opacity: lerp(e, [0, 0.55], [0, 1]),
      transform: [
        { translateX: lerp(e, [0, 1], [from.x + from.w / 2 - (to.x + to.w / 2), 0], false) },
        { translateY: lerp(e, [0, 1], [from.y + from.h / 2 - (to.y + to.h / 2), 0], false) },
        { scale: lerp(e, [0, 1], [s0, 1], false) },
      ],
    };
  } else {
    // The tile's own box grows into the stage (Lift: after it lifts off the grid).
    const liftScale = lerp(lift, [0, 1], [1, 1.06]);
    box = {
      left: lerp(e, [0, 1], [from.x, to.x], false),
      top: lerp(e, [0, 1], [from.y, to.y], false),
      width: lerp(e, [0, 1], [from.w, to.w], false),
      height: lerp(e, [0, 1], [from.h, to.h], false),
      borderRadius: lerp(e, [0, 1], [TILE_RADIUS, toRadius]),
      transform: design === 'lift' ? [{ scale: Animated.add(liftScale, lerp(e, [0, 1], [0, -0.06])) }] : [],
      ...(design === 'lift' && Platform.OS === 'web' ? { boxShadow: '0 18px 48px rgba(0,0,0,0.55)' } : null),
    };
  }
  const backdrop = design === 'zoom' ? lerp(e, [0, 1], [0, 0.75]) : lerp(e, [0, 1], [0, 0.6]);

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.box, box]}>
        <ClipView entry={entry} open={e} top={top} bottom={bottom} onClose={onClose} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  box: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000' },
});
