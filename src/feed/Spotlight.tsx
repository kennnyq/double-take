import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { VideoPlayer } from 'expo-video';
import { MASK_BOX, MASK_SIZE, bands, maskFor, spotlightStrength, type MaskName, type SpotlightEffect, type SpotlightShape, type SpotlightStrength } from './spotlight';
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
 * Black border around the hole image, so the dimming covers the whole stage
 * at any scale (a 44 px hole scales the image down to about 0.17).
 */
const BORDER = 6000;
const SIDE = MASK_SIZE + 2 * BORDER;

/**
 * The double take's spotlight on iOS and Android.
 *
 * The dimming is one view of fixed size: a prepared soft-hole image inside a
 * thick black border. Moving the hole only changes that view's transform and
 * opacity, which Reanimated writes on the UI thread with no layout and nothing
 * redrawn: the GPU just scales a texture. (The first version resized five
 * bordered views and four blur views every frame, over the playing video.)
 *
 * The cheap blur (a blurred still behind the live area) lives with the video
 * in ClipItem. The full blur, live blur views around the hole's bounds, is
 * kept for comparison; it resizes four UIVisualEffectViews as the hole moves
 * and is expensive. Android has no live blur here (it needs a BlurTargetView).
 */
export function Spotlight(p: SpotlightProps) {
  if (p.effect === 'off') return null;
  const { dim, intensity } = spotlightStrength(p.strength);
  const fullBlur = p.effect === 'fullBlur' && Platform.OS === 'ios';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {fullBlur && [0, 1, 2, 3].map((i) => <BlurBand key={i} index={i} m={p.motion} stageW={p.stageW} stageH={p.stageH} intensity={intensity} />)}
      <Dim m={p.motion} dim={dim} image={HOLE_IMAGES[maskFor(p.shape)]} />
    </View>
  );
}

function Dim({ m, dim, image }: { m: SpotlightMotion; dim: number; image: number }) {
  // No opacity on this view: it has a child, and iOS composites a view with a
  // child at partial opacity offscreen every frame. The border's colour and
  // the image carry the alpha instead.
  const frame = useAnimatedStyle(() => ({
    borderColor: `rgba(0,0,0,${(dim * Math.min(1, Math.max(0, m.on.value * 1.3))).toFixed(3)})`,
    transform: [
      { translateX: m.x.value + m.w.value / 2 },
      { translateY: m.y.value + m.h.value / 2 },
      { scaleX: Math.max(0.01, m.w.value / MASK_BOX) },
      { scaleY: Math.max(0.01, m.h.value / MASK_BOX) },
    ],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: dim * Math.min(1, Math.max(0, m.on.value * 1.3)) }));
  return (
    <Animated.View style={[styles.dim, frame]}>
      <Animated.Image source={image} style={[styles.image, fade]} fadeDuration={0} />
    </Animated.View>
  );
}

/** One of the four live blur views around the hole's bounds (full blur only). */
function BlurBand({ index, m, stageW, stageH, intensity }: { index: number; m: SpotlightMotion; stageW: number; stageH: number; intensity: number }) {
  const style = useAnimatedStyle(() => {
    const r = bands(stageW, stageH, { x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value })[index];
    return { left: r.x, top: r.y, width: r.w, height: r.h, opacity: Math.min(1, m.on.value * 4) };
  });
  return (
    <Animated.View style={[styles.band, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Centred on the stage's top-left corner; translated to the hole's centre.
  dim: {
    position: 'absolute',
    left: -SIDE / 2,
    top: -SIDE / 2,
    width: SIDE,
    height: SIDE,
    borderWidth: BORDER,
  },
  image: { width: MASK_SIZE, height: MASK_SIZE },
  band: { position: 'absolute', overflow: 'hidden' },
});
