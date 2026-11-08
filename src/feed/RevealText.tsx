import { useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { lineDelays, lineProgress, revealTimes } from './reveal';

export interface RevealTextProps {
  text: string;
  hint?: string;
  textStyle: (TextStyle | undefined)[];
  hintStyle: (TextStyle | undefined)[];
  /** ms into the reveal (the card runs it up, and back down to leave). */
  clock: SharedValue<number>;
  /** Called once the lines are known, with the reveal's length in ms. */
  onReady: (totalMs: number) => void;
}

/**
 * The card's text, resolving line by line from the top like Siri's answers:
 * each line fades in from faint and a little low. iOS and Android: the text is
 * laid out once, hidden, to learn its line breaks (`onTextLayout`), then drawn
 * a line per animated view, so only a handful of views animate.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady }: RevealTextProps) {
  const [lines, setLines] = useState<string[] | null>(null);
  const delays = lineDelays(lines?.length ?? 0);
  const { hint: hintDelay } = revealTimes(lines?.length ?? 0);
  return (
    <View>
      {/* Measures the line breaks; never seen. */}
      <Text
        style={[...textStyle, styles.measure]}
        onTextLayout={(e) => {
          if (lines) return;
          const ls = e.nativeEvent.lines.map((l) => l.text.replace(/\s+$/, '')).filter(Boolean);
          setLines(ls);
          onReady(revealTimes(ls.length).total);
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>
      {lines?.map((l, i) => (
        <Line key={i} clock={clock} delay={delays[i]}>
          <Text style={textStyle} numberOfLines={1}>
            {l}
          </Text>
        </Line>
      ))}
      {lines && hint ? (
        <Line clock={clock} delay={hintDelay}>
          <Text style={hintStyle}>{hint}</Text>
        </Line>
      ) : null}
    </View>
  );
}

function Line({ clock, delay, children }: { clock: SharedValue<number>; delay: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const e = lineProgress(clock.value, delay);
    return { opacity: e, transform: [{ translateY: (1 - e) * 5 }, { scale: 0.98 + 0.02 * e }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
