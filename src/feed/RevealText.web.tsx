import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { linesFromTops, revealFrame, revealMetrics, revealPlan, revealWords, type RevealUnit } from './reveal';
import type { RevealTextProps } from './RevealText';

/**
 * The card's text in browsers, coming in the way Siri's answer card does (see
 * reveal.ts): line after line rising from below on a gentle spring, the gaps
 * between them closing up, the words fading in in reading order. One reaction
 * writes the moving words' opacity and transform straight to the DOM, and
 * only while the reveal runs.
 *
 * The "wwdc" variant's slight blur is drawn on desktop browsers only (a mouse
 * or trackpad): a filter on every word costs too much on phones.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady, variant = 'siri' }: RevealTextProps) {
  const canBlur = blursText();
  const m = revealMetrics(StyleSheet.flatten(textStyle));
  const hm = revealMetrics(StyleSheet.flatten(hintStyle));
  const words = revealWords(text);
  const units = useRef<(HTMLElement | null)[]>([]);
  const hintEl = useRef<HTMLElement | null>(null);
  // Each word's timing and the hint's, from where the words landed (filled in once laid out).
  const plan = useRef<{ units: RevealUnit[]; hint: RevealUnit } | null>(null);

  useEffect(() => {
    // Measured on screen, relative to the text (the card may be mid-entrance, scaled: ratios still hold).
    const els = units.current.slice(0, words.length);
    const box = (els[0]?.parentElement?.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const rects = els.map((el) => el?.getBoundingClientRect());
    const lines = linesFromTops(rects.map((r) => (r ? r.top - (box?.top ?? 0) : 0)));
    const xs = rects.map((r) => (r && box && box.width ? (r.left + r.width / 2 - box.left) / box.width : 0));
    const p = revealPlan(variant, lines, xs);
    plan.current = { units: p.units, hint: p.hint };
    onReady(p.total);
    // Once, when the card's text is laid out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What each element was last painted with, so only words that are moving get written.
  const painted = useRef(new Map<HTMLElement, string>());
  useAnimatedReaction(
    () => clock.value,
    (ms) => {
      const p = plan.current;
      if (!p) return;
      const paint = (el: HTMLElement | null, u: RevealUnit | undefined, mm: typeof m) => {
        if (!el || !u) return;
        const f = revealFrame(variant, ms, u, mm);
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
      units.current.forEach((el, i) => paint(el, p.units[i], m));
      paint(hintEl.current, p.hint, hm);
    },
    [canBlur, variant],
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
              style={hidden}
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
const hidden = { display: 'inline-block', opacity: 0 } as const;

/** Desktop browsers may blur a word as it resolves (wwdc); touch browsers (phones) don't. */
function blursText(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
