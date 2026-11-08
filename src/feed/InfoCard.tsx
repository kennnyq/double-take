import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { CardSpot } from './card';
import { useGlass } from './glass';
import { ownLayer } from './layer';

interface Props {
  spot: CardSpot;
  text: string;
  /** Faint line under the text, e.g. "Tap to continue". */
  hint?: string;
  /** The slow-mo loop's progress (0..1), drawn as a faint line; none for cards without a loop. */
  loop?: SharedValue<number> | null;
  /** Live blur behind the glass (only with the spotlight's full blur: it's expensive over video). */
  blur?: boolean;
  /** Set to play the exit; `onGone` follows once it's done. */
  leaving: boolean;
  onGone: () => void;
}

/** The pill the card grows out of (and shrinks back into), like the Dynamic Island. */
const PILL_W = 96;
const PILL_H = 28;
const RADIUS = 24;

/** Width opens fast, height follows with a softer spring (it keeps easing out after the width has landed). */
const WIDTH_SPRING = { stiffness: 340, damping: 26, mass: 1 };
const HEIGHT_SPRING = { stiffness: 170, damping: 17, mass: 1 };

/**
 * The double take's info card, with an entrance modelled on iOS's Siri answer
 * card: a dark glass pill appears at the edge the card is anchored to, widens
 * quickly, then grows in height with a soft spring, while the text resolves
 * from faint, slightly low (and, in browsers, blurred) to sharp. The exit runs
 * it backwards, faster: the text goes first and the glass shrinks back into a
 * pill and fades.
 *
 * Performance: the glass is laid out once at its full size; the morph is its
 * transform (scale, and a shift that keeps the anchored edge still), corner
 * radius and opacity, which Reanimated writes on the UI thread without layout.
 * The text never moves in layout either. So nothing is measured or resized
 * while the card animates, and a card leaving mid-entrance turns around from
 * where it is.
 */
export function InfoCard({ spot, text, hint, loop, blur, leaving, onGone }: Props) {
  const [contentH, setContentH] = useState(0);
  const pw = useSharedValue(0);
  const ph = useSharedValue(0);
  const pt = useSharedValue(0);
  const W = spot.width;
  const top = spot.side === 'top';
  const g = useGlass();

  useEffect(() => {
    if (leaving) {
      pt.value = withTiming(0, { duration: 120, easing: Easing.in(Easing.quad) });
      ph.value = withTiming(0, { duration: 210, easing: Easing.in(Easing.cubic) });
      pw.value = withDelay(
        40,
        withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(onGone)();
        }),
      );
      return;
    }
    if (!contentH) return;
    pw.value = withSpring(1, WIDTH_SPRING);
    ph.value = withDelay(30, withSpring(1, HEIGHT_SPRING));
    pt.value = withDelay(110, withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
    // onGone is stable per card (keyed by the overlay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, contentH]);

  const H = contentH || PILL_H;
  const pillW = Math.min(PILL_W, W) / W;
  const glass = useAnimatedStyle(() => {
    const sx = pillW + (1 - pillW) * pw.value;
    const sy = Math.max(0.05, PILL_H / H + (1 - PILL_H / H) * ph.value);
    // The radius it should show at this height, set unscaled (so divided by the vertical scale).
    const visibleH = H * sy;
    return {
      opacity: contentH ? Math.min(1, Math.max(0, Math.max(pw.value, ph.value) * 3)) : 0,
      borderRadius: Math.min(Math.min(visibleH / 2, RADIUS) / sy, H / 2),
      // Scaled about its centre; the shift keeps the anchored edge where it is.
      transform: [{ translateY: ((top ? -1 : 1) * (H - visibleH)) / 2 }, { scaleX: sx }, { scaleY: sy }],
    };
  });
  const content = useAnimatedStyle(() => ({
    opacity: pt.value,
    transform: [{ translateY: (1 - pt.value) * (top ? 8 : -8) }, { scale: 0.96 + 0.04 * pt.value }],
  }));

  // Browsers: the text also starts blurred and sharpens (native views have no blur filter).
  const textRef = useRef<React.ComponentRef<typeof View>>(null);
  useAnimatedReaction(
    () => pt.value,
    (v) => {
      if (Platform.OS !== 'web') return;
      const el = textRef.current as unknown as HTMLElement | null;
      if (el?.style) el.style.filter = v >= 0.999 ? 'none' : `blur(${((1 - v) * 7).toFixed(2)}px)`;
    },
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h && Math.abs(h - contentH) > 1) setContentH(h);
  };

  return (
    <View
      style={[styles.card, { width: W, left: spot.cx - W / 2 }, top ? { top: spot.offset } : { bottom: spot.offset }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={[StyleSheet.absoluteFill, ownLayer, blur && styles.clip, g.glass, blur ? g.tint : g.tintSolid, glass]}>
        {blur ? <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      </Animated.View>
      <Animated.View style={[styles.content, ownLayer, content]} onLayout={onLayout}>
        <View ref={textRef}>
          <Text style={[styles.text, g.text]}>{text}</Text>
          {hint ? <Text style={[styles.hint, g.hint]}>{hint}</Text> : null}
        </View>
        {loop ? <LoopLine loop={loop} /> : <View style={styles.lineSpace} />}
      </Animated.View>
    </View>
  );
}

/** A short, faint line under the text that fills as the slow-mo loop plays; it restarts with the loop. */
function LoopLine({ loop }: { loop: SharedValue<number> }) {
  const g = useGlass();
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(1, Math.max(0, loop.value)) }] }));
  return (
    <View style={[styles.track, g.track]}>
      <Animated.View style={[styles.fill, g.fill, fill]} />
    </View>
  );
}

const LINE_W = 56;

const styles = StyleSheet.create({
  card: { position: 'absolute' },
  // Only around a blur view: a rounded clip costs an offscreen pass every frame.
  clip: { overflow: 'hidden' },
  content: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 9 },
  text: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  track: {
    alignSelf: 'center',
    width: LINE_W,
    height: 2,
    borderRadius: 1,
    marginTop: 9,
    overflow: 'hidden',
  },
  // Scaled from its centre: centre it on the track's left end first.
  fill: { width: LINE_W * 2, height: 2, marginLeft: -LINE_W },
  lineSpace: { height: 4 },
});
