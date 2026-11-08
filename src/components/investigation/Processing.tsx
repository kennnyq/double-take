import { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { themed } from '../../ui/theme';
export function Processing({ uploading }: { uploading: boolean }) {
  const styles = useTint();
  const phase = useSharedValue(0);
  useEffect(() => { phase.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true); return () => cancelAnimation(phase); }, [phase]);
  const motion = useAnimatedStyle(() => ({ transform: [{ scaleX: 0.15 + phase.value * 0.85 }] }));
  return <View accessibilityRole="progressbar" accessibilityLabel={uploading ? 'Uploading video' : 'Processing video'} style={{ gap: 18, paddingVertical: 24 }}>
    <Text style={styles.text}>{uploading ? 'Uploading…' : 'Looking closer…'}</Text>
    <View style={styles.track}><Animated.View style={[styles.line, motion]} /></View>
  </View>;
}
const useTint = themed(c => ({ text: { color: c.text, fontSize: 20 }, track: { height: 2, backgroundColor: c.surfaceRaised }, line: { height: 2, backgroundColor: c.accent, transformOrigin: 'left' } }));
