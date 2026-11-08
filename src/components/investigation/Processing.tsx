import { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { themed } from '../../ui/theme';

export type ProcessingStage = 'uploading' | 'queued' | 'running' | 'complete' | 'error';

/**
 * Where each stage sits on the bar. The bar never knows the real remaining
 * time, so within a stage it eases toward the stage's ceiling in bursts that
 * close part of the gap each time (slowing as it gets near), and a later stage
 * lifts the floor. It only ever moves forward; `complete` runs it to the end.
 */
const RANGES: Record<Exclude<ProcessingStage, 'complete' | 'error'>, [number, number]> = {
  uploading: [0.02, 0.38],
  queued: [0.38, 0.46],
  running: [0.46, 0.94],
};

export function Processing({ uploading, stage }: { uploading: boolean; /** The check's stage, when known; else running (or uploading). */ stage?: ProcessingStage }) {
  const styles = useTint();
  const at: ProcessingStage = uploading ? 'uploading' : stage ?? 'running';
  const p = useSharedValue(0);
  /** Where the bar is heading: only ever raised, so the bar can't go back. */
  const target = useRef(0);
  useEffect(() => {
    const go = (to: number, ms: number) => {
      if (to <= target.current) return;
      target.current = to;
      p.value = withTiming(to, { duration: ms, easing: Easing.inOut(Easing.cubic) });
    };
    if (at === 'complete') {
      go(1, 420);
      return;
    }
    if (at === 'error') {
      cancelAnimation(p);
      return;
    }
    const [floor, ceil] = RANGES[at];
    go(floor, 360);
    let timer: ReturnType<typeof setTimeout>;
    const burst = () => {
      // Close part of what's left to the ceiling, then pause a beat. Checks run longer than
      // uploads, so they creep slower: about 86% of their range by 10 s, 93% by 20 s.
      const share = at === 'running' ? 0.12 + Math.random() * 0.13 : 0.2 + Math.random() * 0.25;
      go(target.current + (ceil - target.current) * share, 380 + Math.random() * 260);
      timer = setTimeout(burst, 650 + Math.random() * 900);
    };
    timer = setTimeout(burst, 260);
    return () => clearTimeout(timer);
  }, [at, p]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: p.value }] }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={uploading ? 'Uploading video' : 'Checking video'} style={{ gap: 18, paddingVertical: 24 }}>
      <Text style={styles.text}>{uploading ? 'Uploading…' : 'Looking closer…'}</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.line, fill]} />
      </View>
    </View>
  );
}
const useTint = themed(c => ({ text: { color: c.text, fontSize: 20 }, track: { height: 3, borderRadius: 2, backgroundColor: c.surfaceRaised, overflow: 'hidden' }, line: { height: 3, backgroundColor: c.accent, transformOrigin: 'left' } }));
