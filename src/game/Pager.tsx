import { useMemo } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { createTapRecognizer } from '@/settings/gesture';

export interface Point {
  x: number;
  y: number;
}

interface Props {
  /** The page the pager rests on. */
  index: number;
  /** Shared with the stage: the pager's position in pages. */
  pos: Animated.Value;
  height: number;
  /** Gestures count only while true (the round is playing and not mid-slide). */
  enabled: boolean;
  /** Double tap or double click: mark the clip AI. */
  onDoubleTap: (at: Point) => void;
  /**
   * The swipe went far or fast enough: skip. Return true to take it (the
   * caller slides on from `velocity`, pages/s); false springs the page back.
   */
  onSwipe: (velocity: number) => boolean;
  children?: React.ReactNode;
}

/** A swipe this far up (fraction of the page), or this fast (px/ms), skips. */
const SWIPE_FRACTION = 0.18;
const SWIPE_VELOCITY = 0.45;
/** Movement under this (px) is a tap, not a drag. */
const TAP_SLOP = 10;

/** Springs the pager to a page: eased, no overshoot past it. */
export function slideTo(pos: Animated.Value, page: number, velocity = 0, onDone?: () => void) {
  Animated.spring(pos, {
    toValue: page,
    velocity,
    stiffness: 260,
    damping: 32,
    mass: 1,
    overshootClamping: true,
    restDisplacementThreshold: 0.001,
    restSpeedThreshold: 0.01,
    useNativeDriver: Platform.OS !== 'web',
  }).start(({ finished }) => finished && onDone?.());
}

/**
 * The round's gesture surface: a forward-only pager. Dragging up moves the
 * page with the finger, and letting go far or fast enough skips; dragging
 * down does nothing (the deck only moves forward). A double tap marks the
 * clip; a single tap does nothing, since the clock is running.
 *
 * Built on PanResponder and Animated, as the rest of the app is, so it needs
 * no gesture-handler root and behaves the same on phones and in browsers.
 */
export function Pager({ index, pos, height, enabled, onDoubleTap, onSwipe, children }: Props) {
  const taps = useMemo(() => createTapRecognizer(), []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabled,
        onMoveShouldSetPanResponder: () => enabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => pos.stopAnimation(),
        onPanResponderMove: (_, g) => {
          if (!enabled || !height) return;
          // Up only, at most one page.
          const pull = Math.min(Math.max(-g.dy / height, 0), 1);
          pos.setValue(index + pull);
        },
        onPanResponderRelease: (e, g) => {
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            slideTo(pos, index);
            if (!enabled) return;
            const { locationX: x, locationY: y, timestamp: t } = e.nativeEvent;
            taps.tap(
              { t, x, y },
              {
                wait: false,
                onSingle: () => {},
                onDouble: () => onDoubleTap({ x, y }),
              },
            );
            return;
          }
          taps.cancel();
          const far = height > 0 && -g.dy / height >= SWIPE_FRACTION;
          const fast = -g.vy >= SWIPE_VELOCITY;
          const velocity = height > 0 ? (-g.vy * 1000) / height : 0;
          if (enabled && (far || fast) && g.dy < 0 && onSwipe(Math.max(0, velocity))) return;
          slideTo(pos, index, velocity);
        },
        onPanResponderTerminate: () => {
          taps.cancel();
          slideTo(pos, index);
        },
      }),
    [pos, taps, index, height, enabled, onDoubleTap, onSwipe],
  );

  return (
    <View style={[StyleSheet.absoluteFill, WEB_SURFACE]} {...responder.panHandlers}>
      {children}
    </View>
  );
}

/** Browsers: no page scroll or text selection from the surface's drags and double clicks. */
const WEB_SURFACE = (Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none', cursor: 'default' } : {}) as ViewStyle;
