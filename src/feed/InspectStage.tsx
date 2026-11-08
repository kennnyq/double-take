import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import { clipTransforms } from './spotlight';
import type { SpotlightMotion } from './spotlightMotion';

/*
 * Pieces of the double take that live with the video in ClipItem, on iOS and
 * Android. They only animate transforms and opacity (Reanimated's UI-thread
 * fast path): no layout, nothing redrawn while they move.
 */

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

/**
 * Rounded corners for the inset video without a rounded clip. A rounded
 * `overflow: hidden` over a playing video makes iOS composite the whole stage
 * offscreen every frame; instead, four black caps (the page is black) cover
 * the corners, each a fixed quarter ring that scales in from its corner as
 * the double take opens.
 */
export function CornerCaps({ radius, progress }: { radius: number; progress: SharedValue<number> }) {
  if (radius <= 0) return null;
  return (
    <>
      {CORNERS.map((c) => (
        <Cap key={c} corner={c} radius={radius} progress={progress} />
      ))}
    </>
  );
}

function Cap({ corner, radius: R, progress }: { corner: Corner; radius: number; progress: SharedValue<number> }) {
  const top = corner[0] === 't';
  const left = corner[1] === 'l';
  const style = useAnimatedStyle(() => ({ transform: [{ scale: Math.min(1, Math.max(0, progress.value)) }] }));
  // A ring (border R) around a circle of radius R, centred on the cap's inner corner.
  const ring = { left: left ? -R : -2 * R, top: top ? -R : -2 * R, width: 4 * R, height: 4 * R, borderRadius: 2 * R, borderWidth: R };
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.cap,
        { width: R, height: R, transformOrigin: `${left ? 'left' : 'right'} ${top ? 'top' : 'bottom'}` },
        top ? { top: 0 } : { bottom: 0 },
        left ? { left: 0 } : { right: 0 },
        style,
      ]}
    >
      <View style={[styles.ring, ring]} />
    </Animated.View>
  );
}

/**
 * The cheap blur's clip: wraps the video so that, while `active` (1), only the
 * spotlight's area of the live video shows. The wrapper's transform maps it
 * onto the area and its child's undoes that, so the video never moves; the
 * wrapper's rectangular clip is what shrinks. Outside the area, the blurred
 * still (below) shows through. At 0 it's the whole stage: no clip.
 */
export function useCheapClip(m: SpotlightMotion, active: SharedValue<number>, stageW: number, stageH: number) {
  const outer = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, m.on.value)) * active.value;
    const r = { x: m.x.value * t, y: m.y.value * t, w: stageW + (m.w.value - stageW) * t, h: stageH + (m.h.value - stageH) * t };
    const { outer: o } = clipTransforms(stageW, stageH, r);
    return { transform: [{ translateX: o.tx }, { translateY: o.ty }, { scaleX: o.sx }, { scaleY: o.sy }] };
  });
  const inner = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, m.on.value)) * active.value;
    const r = { x: m.x.value * t, y: m.y.value * t, w: stageW + (m.w.value - stageW) * t, h: stageH + (m.h.value - stageH) * t };
    const { inner: i } = clipTransforms(stageW, stageH, r);
    return { transform: [{ translateX: i.tx }, { translateY: i.ty }, { scaleX: i.sx }, { scaleY: i.sy }] };
  });
  return { outer, inner };
}

/**
 * The cheap blur's backdrop: one small frame of the loop (where it starts),
 * blurred once by expo-image and shown still, instead of blurring the playing
 * video live every frame.
 */
export function BlurredStill({ player, at, blur, m }: { player: VideoPlayer; at: number; blur: number; m: SpotlightMotion }) {
  const [still, setStill] = useState<VideoThumbnail | null>(null);
  useEffect(() => {
    let live = true;
    player
      .generateThumbnailsAsync(at, { maxWidth: 240 })
      .then(([t]) => {
        if (live && t) setStill(t);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [player, at]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, m.on.value)) }));
  if (!still) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image source={still} style={StyleSheet.absoluteFill} contentFit="contain" blurRadius={blur} transition={180} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cap: { position: 'absolute', overflow: 'hidden' },
  ring: { position: 'absolute', borderColor: '#000' },
});
