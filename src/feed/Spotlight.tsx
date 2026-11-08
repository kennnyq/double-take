import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { VideoPlayer } from 'expo-video';
import { MASK_SIZE, bands, dimBands, maskFor, maskPlacement, spotlightStrength, type MaskName, type SpotlightEffect, type SpotlightShape, type SpotlightStrength } from './spotlight';
import type { SpotlightMotion } from './spotlightMotion';

export interface SpotlightProps {
  motion: SpotlightMotion;
  stageW: number;
  stageH: number;
  effect: SpotlightEffect;
  strength: SpotlightStrength;
  shape: SpotlightShape;
  /** Web only: the player to take the cheap blur's still from, and when to take it again. */
  player?: VideoPlayer | null;
  stillAt?: number | null;
}

/** The dimming images: black outside a soft-edged hole (scripts/spotlight-masks.ts). */
export const HOLE_IMAGES: Record<MaskName, number> = {
  rect: require('../../assets/spotlight/hole-rect.png'),
  rounded: require('../../assets/spotlight/hole-rounded.png'),
  ellipse: require('../../assets/spotlight/hole-ellipse.png'),
  soft: require('../../assets/spotlight/hole-soft.png'),
  blob: require('../../assets/spotlight/hole-blob.png'),
};

/**
 * The double take's spotlight on iOS and Android.
 *
 * The dimming is a prepared soft-hole image and four plain bands around it
 * (see `dimBands`), all fixed-size views without borders. Moving the hole only
 * changes their transforms and opacity, which Reanimated writes on the UI
 * thread with no layout and nothing redrawn: the GPU just scales a texture and
 * four solid rectangles.
 *
 * No borders, on purpose: iOS draws a border it can't hand to Core Animation
 * (a visible border on a view that doesn't clip) into a bitmap the size of the
 * border. The thick border this used before needed about 5 GB, and iOS closed
 * the app as the double take opened.
 *
 * The cheap blur (a blurred still behind the live area) lives with the video
 * in ClipItem. The full blur, live blur views around the hole's bounds, is
 * kept for comparison; it resizes four UIVisualEffectViews as the hole moves
 * and is expensive. Android has no live blur here (it needs a BlurTargetView).
 */
export function Spotlight(p: SpotlightProps) {
  if (p.effect === 'off') return null;
  const fullBlur = p.effect === 'fullBlur' && Platform.OS === 'ios';
  const { dim, intensity } = spotlightStrength(p.strength, fullBlur || p.effect === 'cheapBlur');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {fullBlur && [0, 1, 2, 3].map((i) => <BlurBand key={i} index={i} m={p.motion} stageW={p.stageW} stageH={p.stageH} intensity={intensity} />)}
      <Dim m={p.motion} dim={dim} image={HOLE_IMAGES[maskFor(p.shape)]} stageW={p.stageW} stageH={p.stageH} />
    </View>
  );
}

function Dim({ m, dim, image, stageW, stageH }: { m: SpotlightMotion; dim: number; image: number; stageW: number; stageH: number }) {
  // Every piece is a leaf view carrying its own alpha (no group opacity, which
  // iOS would composite offscreen every frame).
  const fade = useAnimatedStyle(() => {
    const r = maskPlacement({ x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value });
    return {
      opacity: dim * Math.min(1, Math.max(0, m.on.value * 1.3)),
      transform: [
        { translateX: r.x + r.w / 2 },
        { translateY: r.y + r.h / 2 },
        { scaleX: Math.max(1e-3, r.w / MASK_SIZE) },
        { scaleY: Math.max(1e-3, r.h / MASK_SIZE) },
      ],
    };
  });
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <DimBand key={i} index={i} m={m} dim={dim} stageW={stageW} stageH={stageH} />
      ))}
      <Animated.Image source={image} style={[styles.image, fade]} fadeDuration={0} />
    </>
  );
}

/** One of the four plain bands around the hole image: a stage-sized black view, moved and scaled. */
function DimBand({ index, m, dim, stageW, stageH }: { index: number; m: SpotlightMotion; dim: number; stageW: number; stageH: number }) {
  const style = useAnimatedStyle(() => {
    const r = maskPlacement({ x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value });
    const b = dimBands(stageW, stageH, r)[index];
    return {
      opacity: dim * Math.min(1, Math.max(0, m.on.value * 1.3)),
      transform: [{ translateX: b.tx }, { translateY: b.ty }, { scaleX: b.sx }, { scaleY: b.sy }],
    };
  });
  return <Animated.View style={[styles.band, { width: stageW, height: stageH }, style]} />;
}

/** One of the four live blur views around the hole's bounds (full blur only). */
function BlurBand({ index, m, stageW, stageH, intensity }: { index: number; m: SpotlightMotion; stageW: number; stageH: number; intensity: number }) {
  const style = useAnimatedStyle(() => {
    const r = bands(stageW, stageH, { x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value })[index];
    return { left: r.x, top: r.y, width: r.w, height: r.h, opacity: Math.min(1, m.on.value * 4) };
  });
  return (
    <Animated.View style={[styles.blurBand, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Centred on the stage's top-left corner; translated to the hole image's centre.
  image: { position: 'absolute', left: -MASK_SIZE / 2, top: -MASK_SIZE / 2, width: MASK_SIZE, height: MASK_SIZE },
  band: { position: 'absolute', left: 0, top: 0, backgroundColor: '#000' },
  blurBand: { position: 'absolute', overflow: 'hidden' },
});
