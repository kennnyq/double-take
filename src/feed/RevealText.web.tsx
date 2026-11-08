import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { REVEAL_UNIT, revealFrame, revealLetters, revealMetrics, revealSchedule, revealWords, unitDelays, unitStep } from './reveal';
import type { RevealTextProps } from './RevealText';

/**
 * The card's text in browsers, coming in the way Apple's TextRenderer
 * transition does (see reveal.ts): unit after unit in reading order, each
 * fading in from faint while it drops from just above into place (a touch
 * past it and back) and its slight blur clears. One reaction writes the moving
 * units' opacity, transform and blur straight to the DOM, and only while the
 * reveal runs.
 *
 * The blur is for desktop browsers (a mouse or trackpad): a filter on every
 * word costs too much on phones, and at this size Apple's blur is about a
 * pixel, so touch browsers leave it out, as the app does.
 * The "lines" variant groups the words by the line they landed on.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady, variant = 'words' }: RevealTextProps) {
  const unit = REVEAL_UNIT[variant];
  const canBlur = blursText();
  const m = revealMetrics(StyleSheet.flatten(textStyle));
  const hm = revealMetrics(StyleSheet.flatten(hintStyle));
  const words = revealWords(text);
  // Letter units, grouped by word so lines still break between words.
  const groups = unit === 'letter' ? words.map(revealLetters) : words.map((w) => [w]);
  const firsts = groups.map((_, i) => groups.slice(0, i).reduce((a, g) => a + g.length, 0));
  const n = groups.reduce((a, g) => a + g.length, 0);
  const units = useRef<(HTMLElement | null)[]>([]);
  const hintEl = useRef<HTMLElement | null>(null);
  // Per unit: its delay (filled in from the layout for the "lines" variant).
  const delays = useRef<number[]>(unitDelays(n));
  const hintDelay = useRef(revealSchedule(n).hint);

  useEffect(() => {
    let count = n;
    if (unit === 'line') {
      // Words sharing a top share a line.
      const tops = units.current.map((el) => Math.round(el?.offsetTop ?? 0));
      const lines = [...new Set(tops)].sort((a, b) => a - b);
      const step = unitStep(lines.length);
      delays.current = tops.map((t) => lines.indexOf(t) * step);
      count = lines.length;
    } else {
      delays.current = unitDelays(n);
    }
    const schedule = revealSchedule(count);
    hintDelay.current = schedule.hint;
    onReady(schedule.total);
    // Once, when the card's text is laid out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What each element was last painted with, so only units that are moving get written.
  const painted = useRef(new Map<HTMLElement, string>());
  useAnimatedReaction(
    () => clock.value,
    (ms) => {
      const paint = (el: HTMLElement | null, delay: number, mm: typeof m) => {
        if (!el) return;
        const f = revealFrame(ms, delay, mm);
        const opacity = f.opacity.toFixed(3);
        const transform = `translateY(${f.translateY.toFixed(2)}px)`;
        const filter = canBlur && f.blur >= 0.05 ? `blur(${f.blur.toFixed(2)}px)` : 'none';
        const key = `${opacity}|${transform}|${filter}`;
        if (painted.current.get(el) === key) return; // not started yet, or settled
        painted.current.set(el, key);
        el.style.opacity = opacity;
        el.style.transform = transform;
        el.style.filter = filter;
      };
      units.current.forEach((el, i) => paint(el, delays.current[i] ?? 0, m));
      paint(hintEl.current, hintDelay.current, hm);
    },
    [canBlur],
  );

  return (
    <View>
      {/* One text, the units as plain inline spans (cheap to create, and the browser wraps them). */}
      <Text style={textStyle}>
        {groups.map((g, i) => (
          <span key={i}>
            {i > 0 ? ' ' : null}
            {unit === 'letter' ? (
              <span style={word}>
                {g.map((l, j) => (
                  <span
                    key={j}
                    ref={(el) => {
                      units.current[firsts[i] + j] = el;
                    }}
                    style={hidden}
                  >
                    {l}
                  </span>
                ))}
              </span>
            ) : (
              <span
                ref={(el) => {
                  units.current[firsts[i]] = el;
                }}
                style={hidden}
              >
                {g[0]}
              </span>
            )}
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

/** A unit: transformable in the line, unseen until the reveal paints it. */
const hidden = { display: 'inline-block', opacity: 0 } as const;
/** A word of letter units: kept whole on its line. */
const word = { display: 'inline-block', whiteSpace: 'nowrap' } as const;

/** Desktop browsers blur each unit as it resolves; touch browsers (phones) don't. */
function blursText(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
