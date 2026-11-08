import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { linesFromTops, revealFrame, revealMetrics, revealPlan, revealWords, type RevealMetrics, type RevealUnit, type RevealVariant } from './reveal';

export interface RevealTextProps {
  text: string;
  hint?: string;
  textStyle: (TextStyle | undefined)[];
  hintStyle: (TextStyle | undefined)[];
  /** ms into the reveal (the card runs it up, and back down to leave). */
  clock: SharedValue<number>;
  /** Called once the reveal's length is known, in ms. */
  onReady: (totalMs: number) => void;
  /** How it comes in (dev settings → Double take → Text); Siri's way by default. */
  variant?: RevealVariant;
}

type Plan = { units: RevealUnit[]; hint: RevealUnit };

/**
 * The card's text, coming in the way Siri's answer card does (see reveal.ts):
 * line after line rising from below on a gentle spring, the gaps between
 * them closing up, the words fading in in reading order.
 *
 * iOS and Android: one small animated view per word, transform and opacity
 * only, on the UI thread. The words' lines and places along them come from
 * their first layout; nothing shows until then.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady, variant = 'siri' }: RevealTextProps) {
  const m = revealMetrics(StyleSheet.flatten(textStyle));
  const hm = revealMetrics(StyleSheet.flatten(hintStyle));
  const words = revealWords(text);
  const [plan, setPlan] = useState<Plan | null>(null);
  // Each word's frame as it's laid out, and the text's width.
  const frames = useRef<({ x: number; y: number; w: number } | undefined)[]>([]);
  const width = useRef(0);
  const planned = useRef(false);

  // Once, when every word and the text's width are known.
  const tryPlan = () => {
    if (planned.current || !width.current || frames.current.filter(Boolean).length < words.length) return;
    const fs = frames.current.slice(0, words.length) as { x: number; y: number; w: number }[];
    const lines = linesFromTops(fs.map((f) => f.y));
    const xs = fs.map((f) => (f.x + f.w / 2) / width.current);
    const p = revealPlan(variant, lines, xs);
    planned.current = true;
    setPlan({ units: p.units, hint: p.hint });
    onReady(p.total);
  };
  const onWord = (i: number) => (e: LayoutChangeEvent) => {
    const { x, y, width: w } = e.nativeEvent.layout;
    frames.current[i] = { x, y, w };
    tryPlan();
  };

  return (
    <View>
      <View
        style={styles.words}
        onLayout={(e) => {
          width.current = e.nativeEvent.layout.width;
          tryPlan();
        }}
      >
        {words.map((w, i) => (
          <Unit key={i} clock={clock} unit={plan?.units[i]} m={m} variant={variant} onLayout={onWord(i)}>
            <Text style={textStyle}>{w}</Text>
          </Unit>
        ))}
      </View>
      {hint ? (
        <Unit clock={clock} unit={plan?.hint} m={hm} variant={variant}>
          <Text style={hintStyle}>{hint}</Text>
        </Unit>
      ) : null}
    </View>
  );
}

function Unit({
  clock,
  unit,
  m,
  variant,
  onLayout,
  children,
}: {
  clock: SharedValue<number>;
  /** Unknown until the words are laid out: hidden meanwhile. */
  unit: RevealUnit | undefined;
  m: RevealMetrics;
  variant: RevealVariant;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const look = useAnimatedStyle(() => {
    if (!unit) return { opacity: 0, transform: [{ translateY: 0 }] };
    const f = revealFrame(variant, clock.value, unit, m);
    return { opacity: f.opacity, transform: [{ translateY: f.translateY }] };
  });
  return (
    <Animated.View style={look} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A word's space: about a quarter of the type size.
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
});
