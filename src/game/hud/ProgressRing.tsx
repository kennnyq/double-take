import { Animated, StyleSheet, View } from 'react-native';
import { lerp, type AnimNum } from '../motion';

interface Props {
  /** 0..1: how much of the ring is drawn, clockwise from the top. */
  progress: AnimNum;
  size: number;
  stroke: number;
  color: string;
  track: string;
}

/**
 * A ring drawn clockwise from the top to `progress`, with no SVG: two half
 * rings, each turned into its half of the circle in turn. Every frame is a
 * rotation, so it runs on the native driver and never steps.
 */
export function ProgressRing({ progress, size, stroke, color, track }: Props) {
  const half = size / 2;
  const ring = { width: size, height: size, borderRadius: half, borderWidth: stroke, borderColor: color };
  const right = lerp(progress, [0, 0.5, 1], ['0deg', '180deg', '180deg']);
  const left = lerp(progress, [0, 0.5, 1], ['0deg', '0deg', '180deg']);
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, ring, { borderColor: track }]} />
      {/* Right half: the left half ring turns into it through 0–180°. */}
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <Animated.View style={{ position: 'absolute', left: -half, width: size, height: size, transform: [{ rotate: right }] }}>
          <View style={[styles.clip, { left: 0, width: half, height: size }]}>
            <View style={ring} />
          </View>
        </Animated.View>
      </View>
      {/* Left half: the right half ring, through 180–360°. */}
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <Animated.View style={{ position: 'absolute', left: 0, width: size, height: size, transform: [{ rotate: left }] }}>
          <View style={[styles.clip, { left: half, width: half, height: size }]}>
            <View style={[ring, { marginLeft: -half }]} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
});
