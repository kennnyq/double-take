import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { REVEAL_STYLES, revealFrame, revealSchedule, revealWords, unitDelays, unitStep } from './reveal';
import type { RevealTextProps } from './RevealText';

/**
 * The card's text in browsers, coming in the way Apple's answer cards do:
 * word by word in a quick wave in reading order, each word settling into place
 * out of a strong blur as it fades in quickly, on a spring with no overshoot
 * (see reveal.ts). One reaction writes the moving words' opacity, transform
 * and blur straight to the DOM, and only while the reveal runs.
 *
 * The blur itself is for desktop browsers (a mouse or trackpad): on phones a
 * blur filter on every word costs too much (it halved WebKit's frame rate as
 * the card came in), so touch browsers resolve the words the way the app
 * does, with the fade trailing the motion.
 * The "lines" variant groups the words by the line they landed on.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady, variant = 'wave' }: RevealTextProps) {
  const s = REVEAL_STYLES[variant];
  const canBlur = blursText();
  const words = revealWords(text);
  const units = useRef<(HTMLElement | null)[]>([]);
  const hintEl = useRef<HTMLElement | null>(null);
  // Per word: its delay (filled in from the layout for the "lines" variant).
  const delays = useRef<number[]>(unitDelays(words.length, variant));
  const hintDelay = useRef(revealSchedule(words.length, variant).hint);

  useEffect(() => {
    let n = words.length;
    if (s.unit === 'line') {
      // Words sharing a top share a line.
      const tops = units.current.map((el) => Math.round(el?.offsetTop ?? 0));
      const lines = [...new Set(tops)].sort((a, b) => a - b);
      const step = unitStep(lines.length, variant);
      delays.current = tops.map((t) => lines.indexOf(t) * step);
      n = lines.length;
    } else {
      delays.current = unitDelays(words.length, variant);
    }
    const schedule = revealSchedule(n, variant);
    hintDelay.current = schedule.hint;
    onReady(schedule.total);
    // Once, when the card's text is laid out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What each element was last painted with, so only words that are moving get written.
  const painted = useRef(new Map<HTMLElement, string>());
  useAnimatedReaction(
    () => clock.value,
    (ms) => {
      const paint = (el: HTMLElement | null, delay: number) => {
        if (!el) return;
        const f = revealFrame(ms, delay, s, canBlur);
        const opacity = f.opacity.toFixed(2);
        const transform = `translateY(${f.translateY.toFixed(1)}px) scale(${f.scale.toFixed(3)})`;
        const filter = canBlur && f.blur >= 0.1 ? `blur(${f.blur.toFixed(1)}px)` : 'none';
        const key = `${opacity}|${transform}|${filter}`;
        if (painted.current.get(el) === key) return; // not started yet, or settled
        painted.current.set(el, key);
        el.style.opacity = opacity;
        el.style.transform = transform;
        el.style.filter = filter;
      };
      units.current.forEach((el, i) => paint(el, delays.current[i] ?? 0));
      paint(hintEl.current, hintDelay.current);
    },
    [s, canBlur],
  );

  return (
    <View>
      {/* One text, the words as plain inline spans (cheap to create, and the browser wraps them). */}
      <Text style={textStyle}>
        {words.map((w, i) => (
          <span key={i}>
            {i > 0 ? ' ' : null}
            <span
              ref={(el) => {
                units.current[i] = el;
              }}
              style={word}
            >
              {w}
            </span>
          </span>
        ))}
      </Text>
      {hint ? (
        <View
          ref={(el) => {
            hintEl.current = el as unknown as HTMLElement | null;
          }}
          style={styles.hidden}
        >
          <Text style={hintStyle}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Until the reveal paints it.
  hidden: { opacity: 0 },
});

/** A word: transformable in the line, unseen until the reveal paints it. */
const word = { display: 'inline-block', opacity: 0 } as const;

/** Desktop browsers blur each word as it resolves; touch browsers (phones) don't. */
function blursText(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
