import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { REVEAL_UNIT, revealFrame, revealLetters, revealMetrics, revealSchedule, revealWords, unitDelays, type RevealMetrics, type RevealVariant } from './reveal';

export interface RevealTextProps {
  text: string;
  hint?: string;
  textStyle: (TextStyle | undefined)[];
  hintStyle: (TextStyle | undefined)[];
  /** ms into the reveal (the card runs it up, and back down to leave). */
  clock: SharedValue<number>;
  /** Called once the reveal's length is known, in ms. */
  onReady: (totalMs: number) => void;
  /** How it comes in (dev settings → Double take → Text); word by word by default. */
  variant?: RevealVariant;
}

/**
 * The card's text, coming in the way Apple's TextRenderer transition does
 * (see reveal.ts): unit after unit in reading order, each fading in from
 * faint while it drops from just above into place, a touch past it and back.
 *
 * iOS and Android: one small animated view per unit, transform and opacity
 * only, on the UI thread. Apple's blur is about a pixel at this size and a
 * view can't blur cheaply, so it's left out here. The "lines" variant learns
 * the line breaks once (`onTextLayout`) and animates a view per line.
 */
export function RevealText(p: RevealTextProps) {
  const unit = REVEAL_UNIT[p.variant ?? 'words'];
  const m = revealMetrics(StyleSheet.flatten(p.textStyle));
  const hm = revealMetrics(StyleSheet.flatten(p.hintStyle));
  return unit === 'line' ? <Lines {...p} m={m} hm={hm} /> : <Words {...p} m={m} hm={hm} letters={unit === 'letter'} />;
}

type Inner = RevealTextProps & { m: RevealMetrics; hm: RevealMetrics };

function Words({ text, hint, textStyle, hintStyle, clock, onReady, m, hm, letters }: Inner & { letters: boolean }) {
  const words = revealWords(text);
  // Letter units, grouped by word so lines still break between words.
  const groups = letters ? words.map(revealLetters) : words.map((w) => [w]);
  // Each group's first unit's index.
  const firsts = groups.map((_, i) => groups.slice(0, i).reduce((a, g) => a + g.length, 0));
  const n = groups.reduce((a, g) => a + g.length, 0);
  const delays = unitDelays(n);
  const { hint: hintDelay, total } = revealSchedule(n);
  useEffect(() => onReady(total), [onReady, total]);
  return (
    <View>
      <View style={styles.words}>
        {groups.map((g, i) => (
          <View key={i} style={styles.word}>
            {g.map((u, j) => (
              <Unit key={j} clock={clock} delay={delays[firsts[i] + j]} m={m}>
                <Text style={textStyle}>{u}</Text>
              </Unit>
            ))}
          </View>
        ))}
      </View>
      {hint ? (
        <Unit clock={clock} delay={hintDelay} m={hm}>
          <Text style={hintStyle}>{hint}</Text>
        </Unit>
      ) : null}
    </View>
  );
}

function Lines({ text, hint, textStyle, hintStyle, clock, onReady, m, hm }: Inner) {
  const [lines, setLines] = useState<string[] | null>(null);
  const delays = unitDelays(lines?.length ?? 0);
  const { hint: hintDelay } = revealSchedule(lines?.length ?? 0);
  return (
    <View>
      {/* Measures the line breaks; never seen. */}
      <Text
        style={[...textStyle, styles.measure]}
        onTextLayout={(e) => {
          if (lines) return;
          const ls = e.nativeEvent.lines.map((l) => l.text.replace(/\s+$/, '')).filter(Boolean);
          setLines(ls);
          onReady(revealSchedule(ls.length).total);
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>
      {lines?.map((l, i) => (
        <Unit key={i} clock={clock} delay={delays[i]} m={m}>
          <Text style={textStyle} numberOfLines={1}>
            {l}
          </Text>
        </Unit>
      ))}
      {lines && hint ? (
        <Unit clock={clock} delay={hintDelay} m={hm}>
          <Text style={hintStyle}>{hint}</Text>
        </Unit>
      ) : null}
    </View>
  );
}

function Unit({ clock, delay, m, children }: { clock: SharedValue<number>; delay: number; m: RevealMetrics; children: React.ReactNode }) {
  const look = useAnimatedStyle(() => {
    const f = revealFrame(clock.value, delay, m);
    return { opacity: f.opacity, transform: [{ translateY: f.translateY }] };
  });
  return <Animated.View style={look}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // A word's space: about a quarter of the type size.
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
  word: { flexDirection: 'row' },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
