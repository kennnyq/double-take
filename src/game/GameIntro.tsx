import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { HintView } from '@/onboarding/HintView';
import { useAppSettings } from '@/settings/store';
import { usePalette } from '@/ui/theme';
import { lerp, useEased } from './motion';

/**
 * The Game tab's first-run intro, over the first clip: the gesture hint's hand
 * doing the viewer's own double take gesture under "AI?", and how to say real
 * under it. It takes no touches: the first press or answer on the clip puts it
 * away, so a gesture copied from the hand counts. It shows once (see `intro.ts`).
 */
export function GameIntro({ on, desktop }: { on: boolean; desktop: boolean }) {
  const { revealGesture } = useAppSettings();
  const still = useReduceMotion();
  const c = usePalette();
  const ink = { color: c.text };
  const backing = { backgroundColor: `${c.bgDeep}e6` };
  const shown = useEased(on ? 1 : 0, on ? 420 : 300);
  // The hand stays mounted until it has faded out.
  const [mounted, setMounted] = useState(on);
  if (on && !mounted) setMounted(true);
  if (!mounted) return null;
  const real = desktop ? 'Scroll on' : 'Swipe on';
  const label = `AI? ${revealGesture === 'hold' ? 'Hold' : revealGesture === 'doubleTap' ? 'Double tap' : 'Hold or double tap'}. Real? ${real}.`;
  const words = { opacity: lerp(shown, [0.3, 1], [0, 1]), transform: [{ translateY: lerp(shown, [0, 1], [6, 0]) }] };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="game-intro" accessibilityLabel={label}>
      <HintView demo={revealGesture} design="hand" mouse={desktop} still={still} on={on} onGone={() => setMounted(false)} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.Text style={[styles.ask, ink, styles.pill, backing, styles.above, words]}>AI?</Animated.Text>
        <Animated.View style={[styles.below, styles.pill, backing, words]}>
          <Text style={[styles.ask, ink]}>Real?</Text>
          <Text style={[styles.how, ink]}>{real}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 } as const;

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  // Above the hint's hand, and below its caption.
  above: { position: 'absolute', marginTop: -170 },
  below: { position: 'absolute', marginTop: 246, alignItems: 'center', gap: 2 },
  // Fixed paint alpha; only the existing entrance/exit opacity and transform animate.
  pill: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, overflow: 'hidden' },
  ask: { fontSize: 22, fontWeight: '800', ...shadow },
  how: { fontSize: 14, fontWeight: '600', ...shadow },
});
