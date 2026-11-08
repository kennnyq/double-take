import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { themed, usePalette, type Palette } from '@/ui/theme';
import { demoCaption, loopMs, STEP_MS, type DemoStep } from './hints';
import type { HintDesign } from './store';

/**
 * How a hint looks: something physical pressing the clip, with no panel
 * behind it. Every design plays the same steps off one looping clock: each
 * movement is an eased (and on release, springy) curve of it, so the loop
 * joins up with no jump, and the hint itself only ever fades in and out.
 *
 * - finger: a drawn fingertip with its cast and contact shadows; taps ripple
 *   from the contact point, a hold fills a ring around it
 * - fingertip: the same finger with only its shadows and a pressed glow that
 *   swells while it holds
 * - hand: a hand silhouette with a soft drop shadow that tightens as it
 *   presses, with the ripples and the ring
 *
 * With a fine pointer: a cursor that clicks (white with a dark outline and a
 * shadow), and a space bar keycap that presses down and is held.
 */

export type Step = DemoStep | 'swipe';
export interface HintInputKind {
  /** A fine pointer: cursor and keyboard rather than a finger. */
  mouse: boolean;
  /** The layout opens the double take with Space (the desktop feed). */
  spaceKey: boolean;
}

/** The crossfade between steps, as a share of the whole loop on each side of the boundary. */
const XFADE = 0.04;

/** The demos are drawn in a W×H box; the fingertip or cursor tip lands on TARGET. */
const W = 160;
const H = 176;
const TARGET = { x: W / 2, y: 58 };

export function HintView(props: {
  steps: Step[];
  design: HintDesign;
  input: HintInputKind;
  still: boolean;
  on: boolean;
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
  onGone: () => void;
}) {
  const { steps, design, input, still, on, onGone } = props;
  const tint = useTint();
  const [fade] = useState(() => new Animated.Value(0));
  const [clock] = useState(() => new Animated.Value(0));
  const total = loopMs(steps);
  const key = steps.join('+');

  // Each step gets its share of the loop, and is at rest while they crossfade.
  const bounds = [0];
  for (const st of steps) bounds.push(bounds[bounds.length - 1] + STEP_MS[st] / total);
  const multi = steps.length > 1;
  const segOf = (i: number): Seg => [bounds[i] + (multi ? XFADE : 0), bounds[i + 1] - (multi ? XFADE : 0)];
  // Reduce Motion: the first step held still at its most telling moment.
  const [s0, s1] = segOf(0);
  const stillAt = s0 + (s1 - s0) * (steps[0] === 'doubleTap' ? 0.3 : 0.5);

  useEffect(() => {
    const a = Animated.timing(fade, {
      toValue: on ? 1 : 0,
      duration: on ? 380 : 280,
      easing: on ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    a.start(({ finished }) => finished && !on && onGone());
    return () => a.stop();
  }, [on, fade, onGone]);

  useEffect(() => {
    if (still) {
      clock.setValue(stillAt);
      return;
    }
    clock.setValue(0);
    const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [clock, total, still, stillAt, key]);

  const parts = steps.map((st, i) => ({
    st,
    caption: demoCaption(st, input),
    seg: segOf(i),
    opacity: still ? (i === 0 ? 1 : 0) : groupOpacity(clock, i, bounds),
    captionOpacity: captionOpacity(clock, i, bounds),
  }));
  const words = parts.map((pt) => pt.caption);
  const fadeIn = { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] };

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, props.opacity !== undefined && { opacity: props.opacity }]}>
      <Animated.View style={[styles.stage, fadeIn]} testID="gesture-hint" accessible accessibilityRole="text" accessibilityLabel={words.join(', ')}>
        {parts.map((pt) => (
          <Animated.View key={pt.st} style={[StyleSheet.absoluteFill, { opacity: pt.opacity }]}>
            <Demo step={pt.st} clock={clock} seg={pt.seg} input={input} design={design} />
          </Animated.View>
        ))}
        {still ? (
          <Animated.Text style={[styles.caption, tint.caption]} numberOfLines={1}>
            {words.join(' · ')}
          </Animated.Text>
        ) : (
          parts.map((pt) => (
            <Animated.Text key={pt.st} style={[styles.caption, tint.caption, { opacity: pt.captionOpacity }]} numberOfLines={1}>
              {pt.caption}
            </Animated.Text>
          ))
        )}
      </Animated.View>
    </Animated.View>
  );
}

// ---- motion ---------------------------------------------------------------------

type Seg = [number, number];
type Ease = (t: number) => number;
/** [local time 0–1, value, easing into this frame]. */
type Frame = [number, number, Ease?];
type Anim = Animated.AnimatedInterpolation<number>;

const smooth: Ease = Easing.inOut(Easing.cubic);
const press: Ease = Easing.out(Easing.quad);
const springy: Ease = Easing.out(Easing.back(2.2));

/**
 * A value over the loop: keyframes in the step's own time, mapped into its
 * segment of the clock and sampled along each easing, so one linear clock
 * drives every curve and the loop joins up exactly.
 */
function track(clock: Animated.Value, seg: Seg, frames: Frame[]) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  const at = (u: number) => seg[0] + u * (seg[1] - seg[0]);
  frames.forEach(([u, v, ease = smooth], i) => {
    if (i === 0) {
      inputRange.push(at(u));
      outputRange.push(v);
      return;
    }
    const [u0, v0] = frames[i - 1];
    const n = v === v0 ? 1 : 12;
    for (let k = 1; k <= n; k++) {
      inputRange.push(at(u0 + ((u - u0) * k) / n));
      outputRange.push(v0 + (v - v0) * ease(k / n));
    }
  });
  return clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

/** `p` (0 up, 1 pressed, overshooting either way on a springy release) mapped linearly onto [up, down]. */
const lerp = (p: Anim, up: number, down: number) => p.interpolate({ inputRange: [0, 1], outputRange: [up, down], extrapolate: 'extend' });

/**
 * A step's drawing in a loop of several. The next step fades in over the one
 * on screen before that one fades out, so a finger shared by both never dims,
 * and the loop's wrap joins the same way.
 */
function groupOpacity(clock: Animated.Value, i: number, bounds: number[]) {
  if (bounds.length === 2) return 1;
  const s = bounds[i];
  const e = bounds[i + 1];
  // In over [s - XFADE, s], out over [e, e + XFADE], wrapping round the loop.
  const at = (t: number) => {
    let v = 0;
    for (const k of [-1, 0, 1]) {
      const u = t + k;
      v = Math.max(v, Math.min(1, (u - (s - XFADE)) / XFADE, 1 - (u - e) / XFADE));
    }
    return Math.max(0, Math.min(1, v));
  };
  const marks = [0, 1, ...[s - XFADE, s, e, e + XFADE].map((t) => ((t % 1) + 1) % 1)];
  const inputRange = [...new Set(marks)].sort((a, b) => a - b);
  return clock.interpolate({ inputRange, outputRange: inputRange.map(at), extrapolate: 'clamp' });
}

/** A step's caption in a loop of several: one word fades out before the next fades in, so two never overlap. */
function captionOpacity(clock: Animated.Value, i: number, bounds: number[]) {
  if (bounds.length === 2) return 1;
  const s = bounds[i];
  const e = bounds[i + 1];
  return clock.interpolate({ inputRange: [s, s + XFADE, e - XFADE, e], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
}

// ---- the steps --------------------------------------------------------------------

interface DemoProps {
  clock: Animated.Value;
  seg: Seg;
  input: HintInputKind;
  design: HintDesign;
}

function Demo({ step, ...d }: DemoProps & { step: Step }) {
  if (step === 'swipe') return <SwipeDemo {...d} />;
  if (step === 'doubleTap') return <DoubleTapDemo {...d} />;
  if (d.input.mouse && d.input.spaceKey) return <SpaceDemo {...d} />;
  return <HoldDemo {...d} />;
}

const TAP1 = 0.24;
const TAP2 = 0.38;

function DoubleTapDemo({ clock, seg, input, design }: DemoProps) {
  // Down, a springy half lift, down again, and a springy lift off.
  const p = track(clock, seg, [
    [0, 0],
    [TAP1 - 0.08, 0],
    [TAP1, 1, press],
    [TAP1 + 0.07, 0.3, springy],
    [TAP2, 1, press],
    [TAP2 + 0.18, 0, springy],
    [1, 0],
  ]);
  const rings = design !== 'fingertip';
  return (
    <>
      {rings && <Ripple clock={clock} seg={seg} at={TAP1} />}
      {rings && <Ripple clock={clock} seg={seg} at={TAP2} />}
      {!rings && !input.mouse && <PressGlow p={p} />}
      <Presser p={p} input={input} design={design} />
    </>
  );
}

const DOWN = 0.16;
const FULL = 0.64;
const UP = 0.74;

function HoldDemo({ clock, seg, input, design }: DemoProps) {
  const p = track(clock, seg, [[0, 0], [DOWN - 0.08, 0], [DOWN, 1, press], [UP, 1], [UP + 0.16, 0, springy], [1, 0]]);
  const progress = track(clock, seg, [[0, 0], [DOWN + 0.02, 0], [FULL, 1, Easing.inOut(Easing.sin)], [UP + 0.14, 1], [UP + 0.16, 0], [1, 0]]);
  const ringOpacity = track(clock, seg, [[0, 0], [DOWN - 0.04, 0], [DOWN + 0.04, 1], [UP, 1], [UP + 0.12, 0], [1, 0]]);
  // A soft swell as the hold completes: it has done its thing.
  const swell = track(clock, seg, [[0, 0.9], [DOWN - 0.04, 0.9], [DOWN + 0.06, 1, springy], [FULL, 1], [FULL + 0.05, 1.08, press], [UP, 1, springy], [1, 1]]);
  return (
    <>
      {design === 'fingertip' && !input.mouse ? (
        <PressGlow p={p} grow={progress} />
      ) : (
        <Animated.View style={[styles.ringWrap, { opacity: ringOpacity, transform: [{ scale: swell }] }]}>
          <Ring progress={progress} />
        </Animated.View>
      )}
      <Presser p={p} input={input} design={design} />
    </>
  );
}

function SwipeDemo({ clock, seg, input, design }: DemoProps) {
  // Touch down low, slide up while pressed, lift off at the top and fade; come back unseen.
  const p = track(clock, seg, [[0, 0], [0.08, 0], [0.16, 1, press], [0.58, 1], [0.7, 0, springy], [1, 0]]);
  const y = track(clock, seg, [[0, 22], [0.16, 22], [0.62, -26, smooth], [0.8, -32, Easing.out(Easing.quad)], [0.84, 22], [1, 22]]);
  const opacity = track(clock, seg, [[0, 1], [0.66, 1], [0.8, 0, Easing.in(Easing.quad)], [0.84, 0], [1, 1, Easing.out(Easing.quad)]]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, transform: [{ translateY: y }] }]}>
      <Presser p={p} input={{ ...input, mouse: false }} design={design} />
    </Animated.View>
  );
}

/** What presses: a finger, a hand or a cursor, by the design and the input. */
function Presser({ p, input, design }: { p: Anim; input: HintInputKind; design: HintDesign }) {
  if (input.mouse) return <Cursor p={p} />;
  if (design === 'hand') return <Hand p={p} />;
  return <Finger p={p} />;
}

// ---- the finger -------------------------------------------------------------------

const FW = 30;
const FH = 92;
/** The solid part of the finger; below it, it fades out in slices. */
const SOLID = 0.46;
const SLICES = 24;

/**
 * A fingertip pointing up into the clip, shaded like a rounded cylinder with
 * a nail, fading out towards the hand. Lifted, it sits a little lower and
 * larger with its shadows spread and offset; pressed, it squashes onto the
 * contact point and its shadows draw in tight and dark.
 */
function Finger({ p }: { p: Anim }) {
  const tint = useTint();
  const c = usePalette();
  const shade = [
    mix(c.text, c.textDim, 0.55),
    mix(c.text, c.textDim, 0.12),
    c.text,
    mix(c.text, c.textDim, 0.18),
    mix(c.text, c.textDim, 0.7),
  ] as const;
  const sliceH = (FH * (1 - SOLID)) / SLICES;
  return (
    <>
      {/* The finger's cast shadow, falling down and right; it closes in as the finger lands. */}
      <Animated.View
        style={[
          styles.castShadow,
          tint.castShadow,
          { opacity: lerp(p, 0.55, 0.85), transform: [{ translateX: lerp(p, 9, 3) }, { translateY: lerp(p, 16, 5) }] },
        ]}
      />
      {/* Where it meets the clip. */}
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
        {/* The nail, and a crease at the first knuckle. */}
        <LinearGradient colors={[mix(c.text, '#ffffff', 0.6), mix(c.text, c.textDim, 0.25)]} style={[styles.nail, tint.nail]} />
        <View style={[styles.crease, tint.crease, { top: FH * 0.44 }]} />
        <View style={[styles.crease, tint.crease, { top: FH * 0.44 + 4, width: FW * 0.36, left: FW * 0.32 }]} />
      </Animated.View>
    </>
  );
}

/** The finger's opacity down its fading part (0 at the top of it, 1 at the bottom): an ease-out to nothing. */
const fadeAt = (t: number) => Math.pow(1 - t, 1.8);

/**
 * The fingertip design's only feedback besides the shadows: a soft glow where
 * the clip is pressed. `grow` (a hold's 0 → 1) swells it out from the finger.
 */
function PressGlow({ p, grow }: { p: Anim; grow?: Anim }) {
  const tint = useTint();
  const scale = grow ? grow.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.4] }) : lerp(p, 0.6, 1.1);
  const opacity = grow ? Animated.multiply(p, grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0.4] })) : lerp(p, 0, 0.55);
  return <Animated.View style={[styles.glow, tint.glow, { opacity, transform: [{ scale }] }]} />;
}

// ---- the hand ---------------------------------------------------------------------

const HAND = 66;

/** A hand silhouette whose soft drop shadow tightens under it as it presses. */
function Hand({ p }: { p: Anim }) {
  const c = usePalette();
  const scale = lerp(p, 1.04, 0.95);
  return (
    <>
      <Animated.View style={[styles.hand, { opacity: lerp(p, 0.16, 0.3), transform: [{ translateX: lerp(p, 8, 2) }, { translateY: lerp(p, 18, 5) }, { scale }] }]}>
        <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color="#000" style={styles.wideShadow} />
      </Animated.View>
      <Animated.View style={[styles.hand, { transform: [{ translateY: lerp(p, 8, 0) }, { scale }] }]}>
        <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color={c.text} />
      </Animated.View>
    </>
  );
}

// ---- mouse and keyboard ---------------------------------------------------------------

const CURSOR = 40;

/** An arrow cursor, white with a dark outline, lifting off its shadow between clicks. */
function Cursor({ p }: { p: Anim }) {
  const scale = lerp(p, 1, 0.88);
  return (
    <>
      <Animated.View style={[styles.cursor, { opacity: lerp(p, 0.35, 0.55), transform: [{ translateX: lerp(p, 3, 1) }, { translateY: lerp(p, 4, 1.5) }, { scale }] }]}>
        <MaterialCommunityIcons name="cursor-default" size={CURSOR} color="#000" style={styles.softShadow} />
      </Animated.View>
      <Animated.View style={[styles.cursor, { transform: [{ scale }] }]}>
        <MaterialCommunityIcons name="cursor-default" size={CURSOR} color="#ffffff" />
        <MaterialCommunityIcons name="cursor-default-outline" size={CURSOR} color="#000" style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

const KEY_W = 128;
const KEY_H = 40;
const DEPTH = 7;
const TRACK_W = KEY_W - 28;

/** A space bar keycap that presses down and is held, a line under it filling as the hold counts. */
function SpaceDemo({ clock, seg }: DemoProps) {
  const tint = useTint();
  const c = usePalette();
  const p = track(clock, seg, [[0, 0], [DOWN - 0.06, 0], [DOWN, 1, press], [UP, 1], [UP + 0.14, 0, springy], [1, 0]]);
  const progress = track(clock, seg, [[0, 0], [DOWN + 0.02, 0], [FULL, 1, Easing.inOut(Easing.sin)], [UP + 0.12, 1], [UP + 0.2, 0], [1, 0]]);
  const fill = track(clock, seg, [[0, 0], [DOWN, 0], [DOWN + 0.04, 1], [UP + 0.02, 1], [UP + 0.14, 0], [1, 0]]);
  return (
    <View style={styles.keyWrap}>
      {/* Its shadow on the clip, closing in as the key goes down. */}
      <Animated.View style={[styles.keyShadow, tint.keyShadow, { opacity: lerp(p, 0.9, 0.6), transform: [{ scaleX: lerp(p, 1, 0.97) }] }]} />
      <LinearGradient colors={[mix(c.textDim, '#000000', 0.15), mix(c.textDim, '#000000', 0.45)]} style={styles.keySide} />
      <Animated.View style={[styles.keyTop, tint.keyTop, { transform: [{ translateY: lerp(p, 0, DEPTH - 2) }] }]}>
        <LinearGradient colors={[mix(c.text, '#ffffff', 0.5), mix(c.text, c.textDim, 0.3)]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={[styles.keyTrack, tint.keyTrack]}>
        <Animated.View
          style={[styles.keyFill, tint.keyFill, { opacity: fill, transform: [{ translateX: -TRACK_W / 2 }, { scaleX: progress }, { translateX: TRACK_W / 2 }] }]}
        />
      </View>
    </View>
  );
}

// ---- rings --------------------------------------------------------------------------

/** A tap's ring, spreading from the contact point and fading. */
function Ripple({ clock, seg, at }: { clock: Animated.Value; seg: Seg; at: number }) {
  const tint = useTint();
  const scale = track(clock, seg, [[at, 0.4], [at + 0.32, 1.7, Easing.out(Easing.cubic)]]);
  const opacity = track(clock, seg, [[at - 0.001, 0], [at, 0.9], [at + 0.32, 0, Easing.out(Easing.quad)]]);
  return <Animated.View style={[styles.ripple, tint.ripple, { opacity, transform: [{ scale }] }]} />;
}

const RING = 70;
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

const useTint = themed((c: Palette) => ({
  caption: { color: c.text },
  castShadow: { backgroundColor: 'rgba(0,0,0,0.22)', boxShadow: '0 0 14px 7px rgba(0,0,0,0.22)' },
  contact: { backgroundColor: 'rgba(0,0,0,0.5)', boxShadow: '0 0 8px 5px rgba(0,0,0,0.4)' },
  nail: { borderColor: alpha(c.textDim, 0.45) },
  crease: { backgroundColor: alpha(c.textDim, 0.55) },
  glow: { backgroundColor: alpha(c.text, 0.75), boxShadow: `0 0 16px 8px ${alpha(c.text, 0.45)}` },
  ripple: { borderColor: alpha(c.text, 0.95), boxShadow: '0 0 6px rgba(0,0,0,0.35)' },
  ringTrack: { borderColor: 'rgba(0,0,0,0.3)' },
  ringFill: { borderColor: c.accent },
  keyShadow: { backgroundColor: 'rgba(0,0,0,0.35)', boxShadow: '0 4px 14px 4px rgba(0,0,0,0.4)' },
  keyTop: { borderColor: alpha(c.textDim, 0.6) },
  keyTrack: { backgroundColor: 'rgba(0,0,0,0.3)' },
  keyFill: { backgroundColor: c.accent },
}));

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stage: { width: W, height: H },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  wideShadow: { textShadowColor: 'rgba(0,0,0,1)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 },
  softShadow: { textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },

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

  // The glyph's fingertip sits about 0.42 across and 0.07 down its box.
  hand: { position: 'absolute', left: TARGET.x - HAND * 0.42, top: TARGET.y - HAND * 0.07 },
  // The arrow's tip sits about 0.27 across and 0.12 down its box.
  cursor: { position: 'absolute', left: TARGET.x - CURSOR * 0.27, top: TARGET.y - CURSOR * 0.12 },

  ripple: { position: 'absolute', left: TARGET.x - 21, top: TARGET.y - 21, width: 42, height: 42, borderRadius: 21, borderWidth: 2 },
  ringWrap: { position: 'absolute', left: TARGET.x - RING / 2, top: TARGET.y - RING / 2, width: RING, height: RING },
  ringBox: { position: 'absolute', left: 0, top: 0, width: RING, height: RING },
  ring: { position: 'absolute', top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: STROKE },
  halfClip: { position: 'absolute', top: 0, width: RING / 2, height: RING, overflow: 'hidden' },

  keyWrap: { position: 'absolute', left: (W - KEY_W) / 2, top: TARGET.y - KEY_H / 2, width: KEY_W, height: KEY_H + DEPTH + 14 },
  keyShadow: { position: 'absolute', left: 4, right: 4, top: DEPTH + 4, height: KEY_H - 4, borderRadius: 12 },
  keySide: { position: 'absolute', left: 0, right: 0, top: DEPTH, height: KEY_H, borderRadius: 11, overflow: 'hidden' },
  keyTop: { position: 'absolute', left: 0, right: 0, top: 0, height: KEY_H, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  keyTrack: { position: 'absolute', left: (KEY_W - TRACK_W) / 2, width: TRACK_W, top: KEY_H + DEPTH + 9, height: 3, borderRadius: 1.5, overflow: 'hidden' },
  keyFill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: TRACK_W },
});
