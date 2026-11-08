import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { bands, featherLayers, grow, holeFor, spotlightStrength, type Rect, type SpotlightMode, type SpotlightShape, type SpotlightStrength } from './spotlight';
import { currentHole, useSpotlightMotion, type SpotlightMotion } from './spotlightMotion';

export interface SpotlightProps {
  /** The tell's area in stage px; null opens the spotlight out (nothing highlighted). */
  area: Rect | null;
  stageW: number;
  stageH: number;
  mode: SpotlightMode;
  strength: SpotlightStrength;
  shape: SpotlightShape;
}

/** Soft edges are drawn as this many stacked layers. */
const LAYERS = 5;

/**
 * The double take's spotlight on iOS and Android: everything outside the
 * tell's area is darkened through a shaped hole (soft edges are stacked
 * layers, see `featherLayers`) and, on iOS, blurred. The hole springs between
 * areas and opens out to the stage edges when there's none, so it never jumps.
 *
 * A blur view can't have a shaped hole, so the blur is four bands around the
 * shape's bounds (grown by its soft edge); the darkening draws the shape.
 */
export function Spotlight(p: SpotlightProps) {
  const m = useSpotlightMotion(p.area, p.shape);
  const ellipse = holeFor({ x: 0, y: 0, w: 10, h: 10 }, p.shape).ellipse;
  const { dim, intensity } = spotlightStrength(p.strength);
  // Android's blur needs its content wrapped in a BlurTargetView; it dims instead.
  const blur = Platform.OS === 'ios' && p.mode !== 'darken';
  const darken = p.mode !== 'blur' || !blur;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {blur && [0, 1, 2, 3].map((i) => <BlurBand key={i} index={i} m={m} ellipse={ellipse} stageW={p.stageW} stageH={p.stageH} intensity={intensity} />)}
      {darken &&
        Array.from({ length: LAYERS }, (_, k) => (
          <DimLayer key={k} k={k} m={m} ellipse={ellipse} dim={dim} stageW={p.stageW} stageH={p.stageH} />
        ))}
    </View>
  );
}

interface LayerProps {
  m: SpotlightMotion;
  ellipse: boolean;
  stageW: number;
  stageH: number;
}

/** Base size of the circle that is scaled into an ellipse, and its border. */
const BASE = 100;
const BASE_BORDER = 4000;

/** One dimming layer: a border so thick it covers the stage, around a hole. */
function DimLayer({ k, m, ellipse, dim, stageW, stageH }: LayerProps & { k: number; dim: number }) {
  const style = useAnimatedStyle(() => {
    const hole = currentHole(m, ellipse, stageW, stageH);
    const layer = featherLayers(hole, dim, LAYERS)[k];
    if (!layer) return { opacity: 0 };
    const h = layer.hole;
    const opacity = layer.alpha * Math.min(1, Math.max(0, m.on.value * 1.4));
    if (ellipse) {
      return {
        opacity,
        left: h.x + h.w / 2 - BASE / 2 - BASE_BORDER,
        top: h.y + h.h / 2 - BASE / 2 - BASE_BORDER,
        width: BASE + 2 * BASE_BORDER,
        height: BASE + 2 * BASE_BORDER,
        borderWidth: BASE_BORDER,
        borderRadius: BASE / 2 + BASE_BORDER,
        transform: [{ scaleX: Math.max(0.01, h.w / BASE) }, { scaleY: Math.max(0.01, h.h / BASE) }],
      };
    }
    const b = Math.max(stageW, stageH) * 2;
    return {
      opacity,
      left: h.x - b,
      top: h.y - b,
      width: h.w + 2 * b,
      height: h.h + 2 * b,
      borderWidth: b,
      borderRadius: h.radius + b,
      transform: [{ scaleX: 1 }, { scaleY: 1 }],
    };
  });
  return <Animated.View style={[styles.layer, style]} />;
}

/** One of the four blurred bands around the hole's bounds. */
function BlurBand({ index, m, ellipse, stageW, stageH, intensity }: LayerProps & { index: number; intensity: number }) {
  const style = useAnimatedStyle(() => {
    const hole = currentHole(m, ellipse, stageW, stageH);
    const r = bands(stageW, stageH, grow(hole, hole.feather / 2))[index];
    return { left: r.x, top: r.y, width: r.w, height: r.h };
  });
  return (
    <Animated.View style={[styles.band, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', borderColor: '#000' },
  band: { position: 'absolute', overflow: 'hidden' },
});
