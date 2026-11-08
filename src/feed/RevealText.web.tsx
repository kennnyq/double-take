import { useRef } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { revealTimes, wipeEdge } from './reveal';
import type { RevealTextProps } from './RevealText';

/**
 * The card's text in browsers, resolving from the top like Siri's answers.
 * Browsers can't report line breaks, so the text is one block wiped in by a
 * soft, slightly slanted gradient mask (top first, a little left to right)
 * while it sharpens from a blur and drifts up: one element, one style write
 * a frame, however long the text.
 */
export function RevealText({ text, hint, textStyle, hintStyle, clock, onReady }: RevealTextProps) {
  const block = useRef<React.ComponentRef<typeof View>>(null);
  const total = useRef(0);
  const ready = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => {
    if (ready.current) return;
    ready.current = true;
    const lineH = 20;
    const lines = Math.max(1, Math.round(e.nativeEvent.layout.height / lineH));
    total.current = revealTimes(lines).total;
    onReady(total.current);
  };

  useAnimatedReaction(
    () => clock.value,
    (ms) => {
      const el = block.current as unknown as HTMLElement | null;
      if (!el?.style || !total.current) return;
      const t = Math.min(1, ms / total.current);
      const edge = wipeEdge(ms, total.current);
      const mask = t >= 1 ? 'none' : `linear-gradient(172deg, #000 ${(edge - 30).toFixed(1)}%, transparent ${edge.toFixed(1)}%)`;
      el.style.maskImage = mask;
      el.style.setProperty('-webkit-mask-image', mask);
      el.style.filter = t >= 1 ? 'none' : `blur(${((1 - t) * 3).toFixed(2)}px)`;
      el.style.transform = `translateY(${((1 - t) * 4).toFixed(2)}px)`;
    },
  );

  return (
    <View ref={block} onLayout={onLayout} style={hidden}>
      <Text style={textStyle}>{text}</Text>
      {hint ? <Text style={hintStyle}>{hint}</Text> : null}
    </View>
  );
}

/** Until the reveal starts. */
const hidden = { maskImage: 'linear-gradient(transparent, transparent)', WebkitMaskImage: 'linear-gradient(transparent, transparent)' } as object;
