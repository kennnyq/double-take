import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { REVEAL_STYLES, revealFrame, revealSchedule, revealWords, unitDelays, type RevealStyle, type RevealVariant } from './reveal';

export interface RevealTextProps {
  text: string;
  hint?: string;
  textStyle: (TextStyle | undefined)[];
  hintStyle: (TextStyle | undefined)[];
  /** ms into the reveal (the card runs it up, and back down to leave). */
  clock: SharedValue<number>;
  /** Called once the reveal's length is known, in ms. */
  onReady: (totalMs: number) => void;
  /** How it comes in (dev settings → Double take → Text); a word wave by default. */
  variant?: RevealVariant;
}

/**
 * The card's text, coming in the way Apple's does: word by word in a quick
 * wave in reading order, each word settling a few points into place as it
 * fades in, on a spring with no overshoot (see reveal.ts).
 *
 * iOS and Android: one small animated view per word, transform and opacity
 * only, on the UI thread. A view can't blur cheaply there, so the "resolve"
 * comes from opacity trailing the motion (`revealFrame`). The "lines" variant
 * learns the line breaks once (`onTextLayout`) and animates a view per line.
 */
export function RevealText(p: RevealTextProps) {
  const style = REVEAL_STYLES[p.variant ?? 'wave'];
  return style.unit === 'line' ? <Lines {...p} style={style} /> : <Words {...p} style={style} />;
}

function Words({ text, hint, textStyle, hintStyle, clock, onReady, variant, style }: RevealTextProps & { style: RevealStyle }) {
  const words = revealWords(text);
  const delays = unitDelays(words.length, variant);
  const { hint: hintDelay, total } = revealSchedule(words.length, variant);
  useEffect(() => onReady(total), [onReady, total]);
  return (
    <View>
      <View style={styles.words}>
        {words.map((w, i) => (
          <Unit key={i} clock={clock} delay={delays[i]} s={style}>
            <Text style={textStyle}>{w}</Text>
          </Unit>
        ))}
      </View>
      {hint ? (
        <Unit clock={clock} delay={hintDelay} s={style}>
          <Text style={hintStyle}>{hint}</Text>
        </Unit>
      ) : null}
    </View>
  );
}

function Lines({ text, hint, textStyle, hintStyle, clock, onReady, variant, style }: RevealTextProps & { style: RevealStyle }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const delays = unitDelays(lines?.length ?? 0, variant);
  const { hint: hintDelay } = revealSchedule(lines?.length ?? 0, variant);
  return (
    <View>
      {/* Measures the line breaks; never seen. */}
      <Text
        style={[...textStyle, styles.measure]}
        onTextLayout={(e) => {
          if (lines) return;
          const ls = e.nativeEvent.lines.map((l) => l.text.replace(/\s+$/, '')).filter(Boolean);
          setLines(ls);
          onReady(revealSchedule(ls.length, variant).total);
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>
      {lines?.map((l, i) => (
        <Unit key={i} clock={clock} delay={delays[i]} s={style}>
          <Text style={textStyle} numberOfLines={1}>
            {l}
          </Text>
        </Unit>
      ))}
      {lines && hint ? (
        <Unit clock={clock} delay={hintDelay} s={style}>
          <Text style={hintStyle}>{hint}</Text>
        </Unit>
      ) : null}
    </View>
  );
}

function Unit({ clock, delay, s, children }: { clock: SharedValue<number>; delay: number; s: RevealStyle; children: React.ReactNode }) {
  const look = useAnimatedStyle(() => {
    const f = revealFrame(clock.value, delay, s);
    return { opacity: f.opacity, transform: [{ translateY: f.translateY }, { scale: f.scale }] };
  });
  return <Animated.View style={look}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // A word's space: about a quarter of the type size.
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
