import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { CardSpot } from './card';
import { useGlass } from './glass';
import { ownLayer } from './layer';
import { revealDelays, REVEAL_WORD_MS } from './reveal';

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

/** How far the card travels as it comes in (from its side of the subject) and leaves. */
const TRAVEL = 18;
/** Bubbly but quick: a little overshoot, settled in about 400 ms. */
const CARD_SPRING = { stiffness: 260, damping: 17, mass: 1 };
/** The text block's own drift up as it resolves, like Siri's answer. */
const TEXT_RISE = 6;

/**
 * The double take's info card. The card fades in with a short springy move
 * from its side of the subject (rising from below when it sits under it,
 * dropping from above when over it) and leaves the same way, faster.
 *
 * The text resolves like Siri's answers: line by line from the top, and a
 * little left to right within a line, each word fading in from faint, slightly
 * low and (in browsers) blurred, while the block drifts up a few points. It
 * leaves in reverse, quickly. One timeline drives every word on the UI thread.
 *
 * Everything animates transform and opacity only; nothing is laid out again
 * while the card moves.
 */
export function InfoCard({ spot, text, hint, loop, blur, leaving, onGone }: Props) {
  const g = useGlass();
  const W = spot.width;
  const down = spot.from === 'above' ? -1 : 1;
  const words = text.split(/\s+/).filter(Boolean);
  // Lines are known once the words are laid out; until then nothing shows.
  const [delays, setDelays] = useState<number[] | null>(null);
  const tops = useRef<number[]>([]);
  const onWordLayout = (i: number, e: LayoutChangeEvent) => {
    tops.current[i] = e.nativeEvent.layout.y;
    if (delays || tops.current.filter((v) => v !== undefined).length < words.length) return;
    setDelays(revealDelays(tops.current.slice(0, words.length)));
  };
  const lastDelay = delays ? Math.max(0, ...delays) : 0;
  const hintDelay = lastDelay + 70;
  const total = hintDelay + REVEAL_WORD_MS;

  const card = useSharedValue(0); // 0: away, 1: in place (springs past 1 a little)
  const shown = useSharedValue(0); // opacity
  const clock = useSharedValue(0); // ms into the text's reveal

  useEffect(() => {
    if (leaving) {
      clock.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
      card.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
      shown.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(onGone)();
      });
      return;
    }
    if (!delays) return;
    shown.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    card.value = withSpring(1, CARD_SPRING);
    clock.value = withTiming(total, { duration: total, easing: Easing.linear });
    // onGone is stable per card (keyed by the overlay); `total` follows `delays`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, delays]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - card.value) * TRAVEL * down }, { scale: 0.96 + 0.04 * card.value }],
  }));
  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - Math.min(1, clock.value / Math.max(1, total))) * TEXT_RISE }],
  }));

  return (
    <Animated.View
      style={[styles.card, ownLayer, { width: W, left: spot.cx - W / 2 }, spot.side === 'top' ? { top: spot.offset } : { bottom: spot.offset }, cardStyle]}
      pointerEvents="none"
      accessible
      accessibilityLabel={hint ? `${text}. ${hint}` : text}
      accessibilityLiveRegion="polite"
    >
      <View style={[StyleSheet.absoluteFill, styles.glass, blur && styles.clip, g.glass, blur ? g.tint : g.tintSolid]}>
        {blur ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      </View>
      <Animated.View style={[styles.content, blockStyle]}>
        <View style={styles.words}>
          {words.map((w, i) => (
            <RevealWord key={i} clock={clock} delay={delays?.[i] ?? Infinity} onLayout={(e) => onWordLayout(i, e)}>
              <Text style={[styles.text, g.text]}>{w}</Text>
            </RevealWord>
          ))}
        </View>
        {hint ? (
          <RevealWord clock={clock} delay={delays ? hintDelay : Infinity}>
            <Text style={[styles.hint, g.hint]}>{hint}</Text>
          </RevealWord>
        ) : null}
        {loop ? (
          <RevealWord clock={clock} delay={delays ? hintDelay : Infinity} center>
            <LoopLine loop={loop} />
          </RevealWord>
        ) : (
          <View style={styles.lineSpace} />
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** One word (or the hint): fades in from faint, low and blurred once the reveal's clock reaches its delay. */
function RevealWord({
  clock,
  delay,
  children,
  onLayout,
  center,
}: {
  clock: SharedValue<number>;
  delay: number;
  children: React.ReactNode;
  onLayout?: (e: LayoutChangeEvent) => void;
  center?: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (clock.value - delay) / REVEAL_WORD_MS));
    const e = 1 - (1 - t) * (1 - t) * (1 - t); // ease out
    return { opacity: e, transform: [{ translateY: (1 - e) * 5 }, { scale: 0.97 + 0.03 * e }] };
  });
  // Browsers also blur it until it settles (native views have no blur filter).
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  useAnimatedReaction(
    () => Math.min(1, Math.max(0, (clock.value - delay) / REVEAL_WORD_MS)),
    (t) => {
      if (Platform.OS !== 'web') return;
      const el = ref.current as unknown as HTMLElement | null;
      if (el?.style) el.style.filter = t >= 0.999 ? 'none' : `blur(${((1 - t) * 4).toFixed(2)}px)`;
    },
    [delay],
  );
  return (
    <Animated.View ref={ref} style={[center && styles.center, style]} onLayout={onLayout}>
      {children}
    </Animated.View>
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
  glass: { borderRadius: 22 },
  // Only around a blur view: a rounded clip with content costs an offscreen pass.
  clip: { overflow: 'hidden' },
  content: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 9 },
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
  text: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  center: { alignSelf: 'center' },
  track: {
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
