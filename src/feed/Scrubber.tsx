import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { VideoPlayer } from 'expo-video';
import { themed } from '@/ui/theme';
import { alpha } from './glass';
import { easedSeek, safeSeek, setScrubMode } from './scrub';
import { fracAt, pressIntent, timeLabel } from './seek';

interface Props {
  player: VideoPlayer | null;
  /** 0..1, the feed's progress (it moves it as the clip plays). */
  progress: Animated.Value;
  width: number;
  /** Takes touches (the active clip, outside a double take). */
  enabled: boolean;
  /** Hold the clip paused and silent (while scrubbing). */
  onHold: (on: boolean) => void;
  /** A drag is under way: the feed stops scrolling meanwhile. */
  onDrag: (on: boolean) => void;
}

/** Seeking is a property write on the player; kept out of the component body. */
function seekPlayer(player: VideoPlayer, seconds: number) {
  safeSeek(player, seconds);
}

/** Height of the invisible strip that takes touches, along the bottom of the clip. */
const HIT = 28;
const SLIM = 2;
/** How much the bar thickens under a finger. */
const THICK = 2.5;
/** Seeks while dragging, at most this often (ms). */
const DRAG_SEEK_MS = 40;

/**
 * The clip's progress bar, as in the old app (a slim line along the bottom),
 * now something you can grab:
 *  - it thickens under your finger, from a generous invisible strip;
 *  - drag along it and the video follows your finger (paused while you drag,
 *    with a time bubble above it);
 *  - tap somewhere and the video fast-forwards or rewinds there (an eased
 *    scrub, never a jump);
 *  - an up/down swipe that starts on it still moves the feed, and a press on
 *    it never reaches the clip's tap, double-tap or hold.
 */
export function Scrubber({ player, progress, width, enabled, onHold, onDrag }: Props) {
  const tint = useTint();
  const thick = useSharedValue(0);
  const bubbleX = useSharedValue(0);
  const [label, setLabel] = useState<string | null>(null);
  const g = useRef({ x0: 0, y0: 0, startX: 0, mode: 'idle' as 'idle' | 'pending' | 'drag' | 'swipe', lastSeek: 0, cancel: () => {} });
  useEffect(() => () => g.current.cancel(), []);

  const duration = () => (player && player.duration > 0 ? player.duration : 0);
  const press = (on: boolean) => {
    thick.value = withTiming(on ? 1 : 0, { duration: on ? 120 : 260, easing: Easing.out(Easing.cubic) });
  };
  const dragTo = (x: number, force = false) => {
    const d = duration();
    if (!player || !d) return;
    const f = fracAt(x, width);
    progress.setValue(f);
    bubbleX.value = Math.min(width - 48, Math.max(48, x));
    setLabel(timeLabel(f * d, d));
    const now = Date.now();
    if (force || now - g.current.lastSeek >= DRAG_SEEK_MS) {
      g.current.lastSeek = now;
      seekPlayer(player, f * d);
    }
  };
  const endDrag = (x: number) => {
    dragTo(x, true);
    if (player) setScrubMode(player, false);
    setLabel(null);
    onDrag(false);
    onHold(false);
  };

  const handlers = {
    onStartShouldSetResponder: () => enabled && !!player,
    onResponderGrant: (e: GestureResponderEvent) => {
      const s = g.current;
      s.x0 = e.nativeEvent.pageX;
      s.y0 = e.nativeEvent.pageY;
      s.startX = e.nativeEvent.locationX;
      s.mode = 'pending';
      press(true);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = g.current;
      const dx = e.nativeEvent.pageX - s.x0;
      const dy = e.nativeEvent.pageY - s.y0;
      if (s.mode === 'pending') {
        const intent = pressIntent(dx, dy);
        if (intent === 'swipe') {
          s.mode = 'swipe';
          press(false);
        } else if (intent === 'drag' && player) {
          s.mode = 'drag';
          s.cancel();
          onHold(true);
          onDrag(true);
          setScrubMode(player, true);
        }
      }
      if (s.mode === 'drag') dragTo(s.startX + dx);
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const s = g.current;
      const dx = e.nativeEvent.pageX - s.x0;
      if (s.mode === 'drag') endDrag(s.startX + dx);
      else if (s.mode === 'pending' && player && duration()) {
        // A tap: run there.
        s.cancel();
        const d = duration();
        s.cancel = easedSeek(player, fracAt(s.startX, width) * d, onHold, (t) => progress.setValue(t / d));
      }
      s.mode = 'idle';
      press(false);
    },
    // Once dragging, keep the touch; before that, let the feed have a swipe.
    onResponderTerminationRequest: () => g.current.mode !== 'drag',
    onResponderTerminate: () => {
      const s = g.current;
      if (s.mode === 'drag') endDrag(s.startX);
      s.mode = 'idle';
      press(false);
    },
  };

  const track = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + (THICK - 1) * thick.value }] }));
  const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: bubbleX.value - 48 }] }));

  return (
    <View style={[styles.hit, web.touch]} pointerEvents={enabled ? 'auto' : 'none'} {...handlers}>
      <Reanimated.View style={[styles.track, tint.track, track]} pointerEvents="none">
        <Animated.View
          style={[
            styles.fill,
            tint.fill,
            { width, transform: [{ translateX: -width / 2 }, { scaleX: progress }, { translateX: width / 2 }] },
          ]}
        />
      </Reanimated.View>
      {label ? (
        <Reanimated.View style={[styles.bubble, tint.bubble, bubble]} pointerEvents="none">
          <Text style={[styles.bubbleText, tint.bubbleText]}>{label}</Text>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const useTint = themed((c) => ({
  track: { backgroundColor: alpha(c.text, 0.28) },
  fill: { backgroundColor: c.text },
  bubble: { backgroundColor: alpha(c.surface, 0.86) },
  bubbleText: { color: c.text },
}));

/** Browsers: let vertical swipes scroll the feed natively; sideways moves come to us. */
const web = StyleSheet.create({ touch: Platform.OS === 'web' ? ({ touchAction: 'pan-y', cursor: 'pointer' } as object) : {} });

const styles = StyleSheet.create({
  hit: { position: 'absolute', left: 0, right: 0, bottom: 0, height: HIT },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: SLIM, overflow: 'hidden', transformOrigin: 'bottom' },
  fill: { height: SLIM },
  bubble: { position: 'absolute', bottom: HIT + 4, left: 0, width: 96, alignItems: 'center', paddingVertical: 4, borderRadius: 999 },
  bubbleText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
