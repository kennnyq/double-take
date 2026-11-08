import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { themed, usePalette, type Palette } from '@/ui/theme';
import { DEMO_MS, demoCaption, type Demo } from './hints';
import type { HintDesign } from './store';

/**
 * How the hint looks: something physical pressing the clip, over a soft dark
 * pool that keeps it readable on white footage. One looping clock drives every
 * movement as an eased (and on release, springy) curve of it, so the loop
 * joins up with no jump, and the hint itself only ever fades in and out.
 *
 * - hand (default): a hand silhouette with a soft drop shadow that tightens as
 *   it presses; taps ripple from the fingertip, a hold fills a ring around it
 * - finger: a drawn fingertip with its cast and contact shadows, the same
 *   ripples and ring
 * - fingertip: the same finger with only its shadows and a pressed glow that
 *   swells while it holds
 *
 * Desktop shows the same hand; the words name the Space key gestures.
 */

/** The demo is drawn in a W×H box; the fingertip lands on TARGET. */
const W = 160;
const H = 176;
const TARGET = { x: W / 2, y: 58 };

export function HintView(props: {
  demo: Demo;
  design: HintDesign;
  /** A fine pointer: the words name the Space key. */
  mouse: boolean;
  still: boolean;
  on: boolean;
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
  onGone: () => void;
}) {
  const { demo, design, still, on, onGone } = props;
  const tint = useTint();
  const [fade] = useState(() => new Animated.Value(0));
  const [clock] = useState(() => new Animated.Value(0));
  const spec = SPECS[demo];

  useEffect(() => {
    const a = Animated.timing(fade, {
      toValue: on ? 1 : 0,
      duration: on ? 420 : 300,
      easing: on ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    a.start(({ finished }) => {
      if (finished && !on) onGone();
    });
    return () => a.stop();
  }, [on, fade, onGone]);

  useEffect(() => {
    if (still) {
      // Reduce Motion: held still at its most telling moment, pressed.
      clock.setValue(spec.still);
      return;
    }
    clock.setValue(0);
    // Web has no native animation driver: requesting it makes Animated.loop
    // delegate iterations to a fallback timing animation that only runs once.
    const loop = Animated.loop(Animated.timing(clock, {
      toValue: 1,
      duration: DEMO_MS[demo],
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
      // A perpetual tutorial must not hold up virtualized feed rendering.
      isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [clock, demo, spec, still]);

  const caption = demoCaption(demo, { mouse: props.mouse });
  // The hand leads; its words follow a beat behind, rising into place.
  const words = {
    opacity: fade.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }),
    transform: [{ translateY: fade.interpolate({ inputRange: [0, 0.45, 1], outputRange: [6, 6, 0] }) }],
  };

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, props.opacity !== undefined && { opacity: props.opacity }]}>
      {/* A soft dark pool behind it: a plain view, only its opacity and scale move. */}
      <Animated.View style={[styles.scrim, tint.scrim, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]} />
      <Animated.View
        style={[styles.stage, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}
        testID="gesture-hint"
        accessible
        accessibilityRole="text"
        accessibilityLabel={caption}
      >
        <DemoView spec={spec} clock={clock} design={design} />
        <Animated.Text style={[styles.caption, tint.caption, words]} numberOfLines={1}>
          {caption}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

// ---- the demos --------------------------------------------------------------------

type Ease = (t: number) => number;
/** [time in the loop 0–1, value, easing into this frame]. */
export type Frame = [number, number, Ease?];
type Anim = Animated.AnimatedInterpolation<number>;

const smooth: Ease = Easing.inOut(Easing.cubic);
const press: Ease = Easing.out(Easing.quad);
const springy: Ease = Easing.out(Easing.back(2.2));

export interface Spec {
  /** 0 up, 1 pressed: down, a springy half lift between taps, a springy lift off. */
  press: Frame[];
  /** When each tap lands, and how much of the loop its ripple takes. */
  taps: number[];
  ripple: number;
  /** A press and hold: lands, ring full, lets go. */
  hold?: { down: number; full: number; up: number };
  /** Where Reduce Motion holds it still. */
  still: number;
}

export const SPECS: Record<Demo, Spec> = {
  doubleTap: {
    press: [[0, 0], [0.16, 0], [0.24, 1, press], [0.31, 0.3, springy], [0.38, 1, press], [0.56, 0, springy], [1, 0]],
    taps: [0.24, 0.38],
    ripple: 0.32,
    still: 0.25,
  },
  hold: {
    press: [[0, 0], [0.08, 0], [0.16, 1, press], [0.74, 1], [0.9, 0, springy], [1, 0]],
    taps: [],
    ripple: 0,
    hold: { down: 0.16, full: 0.64, up: 0.74 },
    still: 0.45,
  },
  // One demo for both: a quick double tap, a beat, then a press and hold.
  both: {
    press: [[0, 0], [0.07, 0], [0.12, 1, press], [0.155, 0.3, springy], [0.19, 1, press], [0.28, 0, springy], [0.4, 0], [0.46, 1, press], [0.82, 1], [0.92, 0, springy], [1, 0]],
    taps: [0.12, 0.19],
    ripple: 0.17,
    hold: { down: 0.46, full: 0.76, up: 0.82 },
    still: 0.66,
  },
};

/**
 * The same keyframes read at one point `u` of the loop (0–1), for something
 * other than a clock to drive them (the landing's scroll).
 */
export function frameAt(frames: Frame[], u: number): number {
  if (u <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [u1, v1, ease = smooth] = frames[i];
    const [u0, v0] = frames[i - 1];
    if (u <= u1) return u1 === u0 ? v1 : v0 + (v1 - v0) * ease((u - u0) / (u1 - u0));
  }
  return frames[frames.length - 1][1];
}

/**
 * A value over the loop: keyframes sampled along each easing, so one linear
 * clock drives every curve and the loop joins up exactly.
 */
function track(clock: Animated.Value, frames: Frame[]) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  frames.forEach(([u, v, ease = smooth], i) => {
    if (i === 0) {
      inputRange.push(u);
      outputRange.push(v);
      return;
    }
    const [u0, v0] = frames[i - 1];
    const n = v === v0 ? 1 : 12;
    for (let k = 1; k <= n; k++) {
      inputRange.push(u0 + ((u - u0) * k) / n);
      outputRange.push(v0 + (v - v0) * ease(k / n));
    }
  });
  return clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

/** `p` (0 up, 1 pressed, overshooting either way on a springy release) mapped linearly onto [up, down]. */
const lerp = (p: Anim, up: number, down: number) => p.interpolate({ inputRange: [0, 1], outputRange: [up, down], extrapolate: 'extend' });

function DemoView({ spec, clock, design }: { spec: Spec; clock: Animated.Value; design: HintDesign }) {
  const p = track(clock, spec.press);
  const h = spec.hold;
  const progress = h ? track(clock, [[0, 0], [h.down + 0.02, 0], [h.full, 1, Easing.inOut(Easing.sin)], [h.up + 0.1, 1], [h.up + 0.12, 0], [1, 0]]) : null;
  const glowOnly = design === 'fingertip';
  return (
    <>
      {!glowOnly && spec.taps.map((at) => <Ripple key={at} clock={clock} at={at} span={spec.ripple} />)}
      {!glowOnly && h && progress && (
        <Animated.View
          style={[
            styles.ringWrap,
            {
              opacity: track(clock, [[0, 0], [h.down - 0.04, 0], [h.down + 0.04, 1], [h.up, 1], [h.up + 0.08, 0], [1, 0]]),
              // A soft swell as the hold completes: it has done its thing.
              transform: [{ scale: track(clock, [[0, 0.9], [h.down - 0.04, 0.9], [h.down + 0.06, 1, springy], [h.full, 1], [h.full + 0.04, 1.08, press], [h.up, 1, springy], [1, 1]]) }],
            },
          ]}
          testID="gesture-hint-ring"
        >
          <Ring progress={progress} />
        </Animated.View>
      )}
      {glowOnly && <PressGlow p={p} grow={progress} />}
      {design === 'hand' ? <Hand p={p} /> : <Finger p={p} />}
    </>
  );
}

// ---- the hand ---------------------------------------------------------------------

export const HAND = 66;
// The bundled hand-pointing-up glyph uses a 512-unit em, ascent 448.
// Its index finger spans x=256…299; the rounded fingertip's center is y=384.
export const HAND_TIP = { x: (256 + 299) / 2 / 512, y: (448 - 384) / 512 };

/** A hand silhouette whose soft drop shadow tightens under it as it presses. */
function Hand({ p }: { p: Anim }) {
  const c = usePalette();
  const scale = lerp(p, 1.04, 0.95);
  return (
    <>
      <Animated.View style={[styles.hand, { opacity: lerp(p, 0.16, 0.3), transform: [{ translateX: lerp(p, 8, 2) }, { translateY: lerp(p, 18, 5) }, { scale }] }]}>
        <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color="#000" style={[styles.handGlyph, styles.wideShadow]} />
      </Animated.View>
      <Animated.View testID="gesture-hint-hand" style={[styles.hand, { transform: [{ translateY: lerp(p, 8, 0) }, { scale }] }]}>
        <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color={c.text} style={styles.handGlyph} />
      </Animated.View>
    </>
  );
}

// ---- the finger -------------------------------------------------------------------

const FW = 30;
const FH = 92;
/** The solid part of the finger; below it, it fades out in slices. */
const SOLID = 0.46;
const SLICES = 24;
/** The finger's opacity down its fading part (0 at the top of it, 1 at the bottom): an ease-out to nothing. */
const fadeAt = (t: number) => Math.pow(1 - t, 1.8);

/**
 * A fingertip pointing up into the clip, shaded like a rounded cylinder with
 * a nail, fading out towards the hand. Lifted, it sits a little lower and
 * larger with its shadows spread and offset; pressed, it squashes onto the
 * contact point and its shadows draw in tight and dark.
 */
function Finger({ p }: { p: Anim }) {
  const tint = useTint();
  const c = usePalette();
  const shade = [mix(c.text, c.textDim, 0.55), mix(c.text, c.textDim, 0.12), c.text, mix(c.text, c.textDim, 0.18), mix(c.text, c.textDim, 0.7)] as const;
  const sliceH = (FH * (1 - SOLID)) / SLICES;
  return (
    <>
      <Animated.View
        style={[styles.castShadow, tint.castShadow, { opacity: lerp(p, 0.55, 0.85), transform: [{ translateX: lerp(p, 9, 3) }, { translateY: lerp(p, 16, 5) }] }]}
      />
      <Animated.View
        style={[
          styles.contact,
          tint.contact,
          { opacity: lerp(p, 0.12, 0.6), transform: [{ translateX: lerp(p, 5, 0) }, { translateY: lerp(p, 8, 0) }, { scale: lerp(p, 1.35, 0.85) }] },
        ]}
      />
      <Animated.View
        style={[
          styles.finger,
          // Lifted it sits lower and a touch larger; pressed it squashes about the tip, so the contact point stays put.
          {
            transform: [
              { translateY: lerp(p, 9, 0) },
              { scale: lerp(p, 1.05, 1) },
              { translateY: -FH / 2 },
              { scaleY: lerp(p, 1, 0.93) },
              { scaleX: lerp(p, 1, 1.04) },
              { translateY: FH / 2 },
            ],
          },
        ]}
      >
        <LinearGradient colors={shade} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fingerTop} />
        {Array.from({ length: SLICES }, (_, i) => (
          <LinearGradient
            key={i}
            colors={shade}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.slice, { top: FH * SOLID + i * sliceH, height: sliceH + 0.6, opacity: fadeAt((i + 0.5) / SLICES) }]}
          />
        ))}
        <LinearGradient colors={[mix(c.text, '#ffffff', 0.6), mix(c.text, c.textDim, 0.25)]} style={[styles.nail, tint.nail]} />
        <View style={[styles.crease, tint.crease, { top: FH * 0.44 }]} />
        <View style={[styles.crease, tint.crease, { top: FH * 0.44 + 4, width: FW * 0.36, left: FW * 0.32 }]} />
      </Animated.View>
    </>
  );
}

/** The fingertip design's feedback: a soft glow where it presses, swelling as a hold (`grow` 0 → 1) counts. */
function PressGlow({ p, grow }: { p: Anim; grow: Anim | null }) {
  const tint = useTint();
  const scale = grow ? Animated.add(lerp(p, 0.6, 1.1), grow.interpolate({ inputRange: [0, 1], outputRange: [0, 1.3] })) : lerp(p, 0.6, 1.1);
  return <Animated.View style={[styles.glow, tint.glow, { opacity: lerp(p, 0, 0.55), transform: [{ scale }] }]} />;
}

// ---- rings --------------------------------------------------------------------------

/** A tap's ring, spreading from the contact point and fading. */
function Ripple({ clock, at, span }: { clock: Animated.Value; at: number; span: number }) {
  const tint = useTint();
  const scale = track(clock, [[at, 0.4], [at + span, 1.7, Easing.out(Easing.cubic)]]);
  const opacity = track(clock, [[at - 0.001, 0], [at, 0.9], [at + span, 0, Easing.out(Easing.quad)]]);
  return <Animated.View style={[styles.ripple, tint.ripple, { opacity, transform: [{ scale }] }]} />;
}

export const RING = 54;
export const RIPPLE = RING * 0.6;
const STROKE = 3;

/**
 * A ring that fills clockwise from the top as `progress` goes 0 → 1, without
 * SVG: each half clips a half ring that turns into view.
 */
function Ring({ progress }: { progress: Anim }) {
  const tint = useTint();
  const right = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'], extrapolate: 'clamp' });
  const left = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'], extrapolate: 'clamp' });
  const half = (side: 'left' | 'right', rotate: Animated.AnimatedInterpolation<string>) => (
    <View style={[styles.halfClip, side === 'right' ? { left: RING / 2 } : { left: 0 }]}>
      <Animated.View style={[styles.ringBox, { left: side === 'right' ? -RING / 2 : 0, transform: [{ rotate }] }]}>
        <View style={[styles.halfClip, { left: side === 'right' ? 0 : RING / 2 }]}>
          <View style={[styles.ring, tint.ringFill, { left: side === 'right' ? 0 : -RING / 2 }]} />
        </View>
      </Animated.View>
    </View>
  );
  return (
    <View style={styles.ringBox}>
      <View style={[styles.ring, tint.ringTrack]} />
      {half('right', right)}
      {half('left', left)}
    </View>
  );
}

// ---- styles ---------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** `a` blended towards `b` by `t`, as a hex colour (so it can be blended again). */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** A radial fade from the palette's darkest colour to nothing (a plain style value: no blur, nothing per frame). */
function pool(c: Palette): ViewStyle {
  const [r, g, b] = rgb(c.bg);
  const at = (a: number) => `rgba(${r},${g},${b},${a})`;
  return { backgroundImage: `radial-gradient(circle closest-side, ${at(0.42)} 0%, ${at(0.3)} 40%, ${at(0.12)} 72%, ${at(0)} 100%)` } as ViewStyle;
}

const useTint = themed((c: Palette) => ({
  scrim: pool(c),
  caption: { color: c.text, backgroundColor: alpha(c.bgDeep, 0.9) },
  castShadow: { backgroundColor: 'rgba(0,0,0,0.22)', boxShadow: '0 0 14px 7px rgba(0,0,0,0.22)' },
  contact: { backgroundColor: 'rgba(0,0,0,0.5)', boxShadow: '0 0 8px 5px rgba(0,0,0,0.4)' },
  nail: { borderColor: alpha(c.textDim, 0.45) },
  crease: { backgroundColor: alpha(c.textDim, 0.55) },
  glow: { backgroundColor: alpha(c.text, 0.75), boxShadow: `0 0 16px 8px ${alpha(c.text, 0.45)}` },
  ripple: { borderColor: alpha(c.text, 0.95), boxShadow: '0 0 6px rgba(0,0,0,0.35)' },
  ringTrack: { borderColor: 'rgba(0,0,0,0.3)' },
  ringFill: { borderColor: c.accent },
}));

const SCRIM = 300;

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stage: { width: W, height: H },
  scrim: { position: 'absolute', width: SCRIM, height: SCRIM, borderRadius: SCRIM / 2 },
  caption: {
    position: 'absolute',
    left: (W - SCRIM) / 2,
    width: SCRIM,
    // Text's one-line web style defaults to maxWidth: '100%' of the 160px
    // icon stage. Override it so the wider caption fits and stays centered.
    maxWidth: SCRIM,
    bottom: 6,
    // A real text backing stays legible even over burned-in white captions.
    // Its alpha is in the paint, not a translucent parent over playing video.
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  wideShadow: { textShadowColor: 'rgba(0,0,0,1)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 },

  // A zero-size anchor makes scaling pivot on the contact point, not the palm.
  hand: { position: 'absolute', left: TARGET.x, top: TARGET.y, width: 0, height: 0 },
  handGlyph: {
    position: 'absolute',
    left: -HAND * HAND_TIP.x,
    top: -HAND * HAND_TIP.y,
    width: HAND,
    height: HAND,
    lineHeight: HAND,
    includeFontPadding: false,
  },

  finger: { position: 'absolute', left: TARGET.x - FW / 2, top: TARGET.y - 4, width: FW, height: FH },
  fingerTop: { position: 'absolute', left: 0, right: 0, top: 0, height: FH * SOLID + 0.5, borderTopLeftRadius: FW / 2, borderTopRightRadius: FW / 2 },
  slice: { position: 'absolute', left: 0, right: 0 },
  nail: {
    position: 'absolute',
    left: FW * 0.2,
    top: 3,
    width: FW * 0.6,
    height: FW * 0.72,
    borderTopLeftRadius: FW * 0.3,
    borderTopRightRadius: FW * 0.3,
    borderBottomLeftRadius: FW * 0.22,
    borderBottomRightRadius: FW * 0.22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  crease: { position: 'absolute', left: FW * 0.25, width: FW * 0.5, height: 1.5, borderRadius: 1 },
  castShadow: { position: 'absolute', left: TARGET.x - FW / 2 + 3, top: TARGET.y, width: FW - 6, height: FH * 0.5, borderRadius: FW / 2 },
  contact: { position: 'absolute', left: TARGET.x - 13, top: TARGET.y - 2, width: 26, height: 14, borderRadius: 13 },
  glow: { position: 'absolute', left: TARGET.x - 12, top: TARGET.y - 10, width: 24, height: 24, borderRadius: 12 },

  ripple: { position: 'absolute', left: TARGET.x - RIPPLE / 2, top: TARGET.y - RIPPLE / 2, width: RIPPLE, height: RIPPLE, borderRadius: RIPPLE / 2, borderWidth: 2 },
  ringWrap: { position: 'absolute', left: TARGET.x - RING / 2, top: TARGET.y - RING / 2, width: RING, height: RING },
  ringBox: { position: 'absolute', left: 0, top: 0, width: RING, height: RING },
  ring: { position: 'absolute', top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: STROKE },
  halfClip: { position: 'absolute', top: 0, width: RING / 2, height: RING, overflow: 'hidden' },
});
