import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { themed, usePalette, type Palette } from '@/ui/theme';
import { demoCaption, loopMs, STEP_MS, type DemoStep } from './hints';
import type { HintDesign } from './store';

/**
 * How a hint looks. Every design plays the same steps off one looping clock:
 * each movement is an eased curve of it, so the loop joins up with no jump,
 * and the hint itself only ever fades in and out.
 *
 * - tile: a frosted tile with a hand (or a cursor and a space bar) and a caption
 * - ring: no backdrop, just a ring and a dot on the clip, captioned under
 * - pill: a small pill low on the clip, a tiny animated glyph beside the caption
 */

export type Step = DemoStep | 'swipe';
export interface HintInputKind {
  /** A fine pointer: cursor and keyboard rather than a hand. */
  mouse: boolean;
  /** The layout opens the double take with Space (the desktop feed). */
  spaceKey: boolean;
}

/** The crossfade between steps, as a share of the whole loop on each side of the boundary. */
const XFADE = 0.04;

/** The demos are drawn in a TILE-square box; the finger, cursor or dot lands on TARGET. */
const TILE = 148;
const TARGET = { x: TILE / 2, y: 48 };
const HAND = 56;

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

  useEffect(() => {
    const a = Animated.timing(fade, {
      toValue: on ? 1 : 0,
      duration: on ? 360 : 280,
      easing: on ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    a.start(({ finished }) => finished && !on && onGone());
    return () => a.stop();
  }, [on, fade, onGone]);

  useEffect(() => {
    if (still) return;
    clock.setValue(0);
    const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [clock, total, still, key]);

  // Each step gets its share of the loop, and is at rest while they crossfade.
  const bounds = [0];
  for (const st of steps) bounds.push(bounds[bounds.length - 1] + STEP_MS[st] / total);
  const multi = steps.length > 1;
  const parts = steps.map((st, i) => ({
    st,
    caption: demoCaption(st, input),
    seg: [bounds[i] + (multi ? XFADE : 0), bounds[i + 1] - (multi ? XFADE : 0)] as Seg,
    opacity: groupOpacity(clock, i, bounds),
    captionOpacity: captionOpacity(clock, i, bounds),
  }));
  const words = parts.map((pt) => pt.caption);
  const fadeIn = { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] };
  const a11y = { testID: 'gesture-hint', accessible: true, accessibilityRole: 'text' as const, accessibilityLabel: words.join(', ') };

  const demos = (marker: Marker, mini?: boolean) =>
    parts.map((pt) => (
      <Animated.View key={pt.st} style={[mini ? miniStage(focusOf(pt.st, input)) : StyleSheet.absoluteFill, { opacity: pt.opacity }]}>
        <Demo step={pt.st} clock={clock} seg={pt.seg} input={input} marker={marker} />
      </Animated.View>
    ));
  const captions = (style: object) =>
    still ? (
      <Text style={style} numberOfLines={1}>
        {words.join(' · ')}
      </Text>
    ) : (
      parts.map((pt) => (
        <Animated.Text key={pt.st} style={[style, { opacity: pt.captionOpacity }]} numberOfLines={1}>
          {pt.caption}
        </Animated.Text>
      ))
    );

  let body: ReactNode;
  if (design === 'pill') {
    body = (
      <View style={styles.pillLane} pointerEvents="none">
        <Animated.View style={[styles.pill, tint.glass, fadeIn]} {...a11y}>
          <View style={styles.glyph}>
            {still ? <StillIcons steps={steps} input={input} size={20} /> : demos('pointer', true)}
          </View>
          <View style={still ? null : styles.pillWords}>{captions([still ? styles.pillCaptionStill : styles.pillCaption, tint.caption])}</View>
        </Animated.View>
      </View>
    );
  } else {
    const ring = design === 'ring';
    body = (
      <Animated.View style={[styles.tile, !ring && tint.glass, !ring && styles.tileGlass, fadeIn]} {...a11y}>
        {still ? (
          <View style={styles.stillRow}>
            <StillIcons steps={steps} input={input} size={steps.length > 1 ? 40 : 52} shadow={ring} />
          </View>
        ) : (
          demos(ring ? 'dot' : 'pointer')
        )}
        {captions([styles.caption, ring && styles.captionBare, tint.caption])}
      </Animated.View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, props.opacity !== undefined && { opacity: props.opacity }]}>
      {body}
    </Animated.View>
  );
}

// ---- motion ---------------------------------------------------------------------

type Seg = [number, number];
type Ease = (t: number) => number;
/** [local time 0–1, value, easing into this frame]. */
type Frame = [number, number, Ease?];

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
    const n = v === v0 ? 1 : 10;
    for (let k = 1; k <= n; k++) {
      inputRange.push(at(u0 + ((u - u0) * k) / n));
      outputRange.push(v0 + (v - v0) * ease(k / n));
    }
  });
  return clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

/**
 * A step's drawing in a loop of several. The next step fades in over the one
 * on screen before that one fades out, so a hand shared by both never dims,
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
      const up = (u - (s - XFADE)) / XFADE;
      const down = 1 - (u - e) / XFADE;
      v = Math.max(v, Math.min(1, up, down));
    }
    return Math.max(0, Math.min(1, v));
  };
  const marks = [0, 1, s - XFADE, s, e, e + XFADE].map((t) => ((t % 1) + 1) % 1);
  marks.push(0, 1);
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

/** `pointer`: a hand, or a cursor and a space bar. `dot`: a bare touch dot. */
type Marker = 'pointer' | 'dot';

function Demo({ step, clock, seg, input, marker }: { step: Step; clock: Animated.Value; seg: Seg; input: HintInputKind; marker: Marker }) {
  if (step === 'swipe') return <SwipeDemo clock={clock} seg={seg} marker={marker} />;
  if (step === 'doubleTap') return <DoubleTapDemo clock={clock} seg={seg} mouse={input.mouse} marker={marker} />;
  if (marker === 'pointer' && input.mouse && input.spaceKey) return <SpaceDemo clock={clock} seg={seg} />;
  return <HoldDemo clock={clock} seg={seg} mouse={input.mouse} marker={marker} />;
}

type Anim = Animated.AnimatedInterpolation<number>;

/** The finger, the cursor or the dot, landing on TARGET. `scale` 1 at rest, 0.88 pressed. */
function Touch({ marker, mouse, y, scale }: { marker: Marker; mouse: boolean; y: Anim; scale: Anim }) {
  const c = usePalette();
  const tint = useTint();
  if (marker === 'dot') {
    const s = scale.interpolate({ inputRange: [0.88, 1], outputRange: [0.72, 1] });
    return <Animated.View style={[styles.dot, tint.dot, { transform: [{ scale: s }] }]} />;
  }
  return (
    <Animated.View style={[mouse ? styles.cursor : styles.hand, { transform: [{ translateY: y }, { scale }] }]}>
      <MaterialCommunityIcons name={mouse ? 'cursor-default' : 'hand-pointing-up'} size={mouse ? 34 : HAND} color={c.text} style={styles.iconShadow} />
    </Animated.View>
  );
}

/** A tap's ring, spreading from TARGET and fading. */
function Ripple({ clock, seg, at }: { clock: Animated.Value; seg: Seg; at: number }) {
  const tint = useTint();
  const scale = track(clock, seg, [[at, 0.35], [at + 0.32, 1.6, Easing.out(Easing.cubic)]]);
  const opacity = track(clock, seg, [[at - 0.001, 0], [at, 0.85], [at + 0.32, 0, Easing.out(Easing.quad)]]);
  return <Animated.View style={[styles.ripple, tint.ripple, { opacity, transform: [{ scale }] }]} />;
}

const TAP1 = 0.24;
const TAP2 = 0.38;

function DoubleTapDemo({ clock, seg, mouse, marker }: { clock: Animated.Value; seg: Seg; mouse: boolean; marker: Marker }) {
  const rest = mouse ? 0 : 8;
  const y = track(clock, seg, [
    [0, rest],
    [TAP1 - 0.08, rest],
    [TAP1, 0, press],
    [TAP1 + 0.06, rest * 0.6, springy],
    [TAP2, 0, press],
    [TAP2 + 0.16, rest, springy],
    [1, rest],
  ]);
  const scale = track(clock, seg, [
    [0, 1],
    [TAP1 - 0.08, 1],
    [TAP1, 0.88, press],
    [TAP1 + 0.06, 0.96, springy],
    [TAP2, 0.88, press],
    [TAP2 + 0.16, 1, springy],
    [1, 1],
  ]);
  return (
    <>
      <Ripple clock={clock} seg={seg} at={TAP1} />
      <Ripple clock={clock} seg={seg} at={TAP2} />
      <Touch marker={marker} mouse={mouse} y={y} scale={scale} />
    </>
  );
}

const DOWN = 0.16;
const FULL = 0.64;
const UP = 0.74;

function HoldDemo({ clock, seg, mouse, marker }: { clock: Animated.Value; seg: Seg; mouse: boolean; marker: Marker }) {
  const rest = mouse ? 0 : 8;
  const y = track(clock, seg, [[0, rest], [DOWN - 0.08, rest], [DOWN, 0, press], [UP, 0], [UP + 0.12, rest, springy], [1, rest]]);
  const scale = track(clock, seg, [[0, 1], [DOWN - 0.08, 1], [DOWN, 0.88, press], [UP, 0.88], [UP + 0.12, 1, springy], [1, 1]]);
  const progress = track(clock, seg, [[0, 0], [DOWN + 0.02, 0], [FULL, 1, Easing.inOut(Easing.sin)], [UP + 0.14, 1], [UP + 0.16, 0], [1, 0]]);
  const ringOpacity = track(clock, seg, [[0, 0], [DOWN - 0.04, 0], [DOWN + 0.04, 1], [UP, 1], [UP + 0.12, 0], [1, 0]]);
  // A soft swell as the ring closes: the hold has done its thing.
  const ringScale = track(clock, seg, [[0, 0.9], [DOWN - 0.04, 0.9], [DOWN + 0.06, 1, springy], [FULL, 1], [FULL + 0.05, 1.08, press], [UP, 1, springy], [1, 1]]);
  return (
    <>
      <Animated.View style={[styles.ringWrap, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}>
        <Ring progress={progress} />
      </Animated.View>
      <Touch marker={marker} mouse={mouse} y={y} scale={scale} />
    </>
  );
}

const RING = 66;
const STROKE = 3;

/**
 * A ring that fills clockwise from the top as `progress` goes 0 → 1, without
 * SVG: each half clips a half ring that turns into view.
 */
function Ring({ progress }: { progress: Anim }) {
  const tint = useTint();
  const right = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'], extrapolate: 'clamp' });
  const left = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'], extrapolate: 'clamp' });
  // A half ring on one side of a RING-square box, so it turns about the ring's centre.
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

const KEY_W = 104;
const KEY_H = 34;

/** A space bar pressed and held, filling as the hold counts. */
function SpaceDemo({ clock, seg }: { clock: Animated.Value; seg: Seg }) {
  const tint = useTint();
  const y = track(clock, seg, [[0, 0], [DOWN - 0.06, 0], [DOWN, 3, press], [UP, 3], [UP + 0.1, 0, springy], [1, 0]]);
  const progress = track(clock, seg, [[0, 0], [DOWN + 0.02, 0], [FULL, 1, Easing.inOut(Easing.sin)], [UP + 0.12, 1], [UP + 0.2, 0], [1, 0]]);
  const fillOpacity = track(clock, seg, [[0, 0], [DOWN, 0], [DOWN + 0.04, 1], [UP + 0.02, 1], [UP + 0.14, 0], [1, 0]]);
  return (
    <View style={styles.keyWrap}>
      <View style={[styles.keyBase, tint.keyBase]} />
      <Animated.View style={[styles.key, tint.key, { transform: [{ translateY: y }] }]}>
        <Animated.View
          style={[
            styles.keyFill,
            tint.keyFill,
            { opacity: fillOpacity, transform: [{ translateX: -KEY_W / 2 }, { scaleX: progress }, { translateX: KEY_W / 2 }] },
          ]}
        />
      </Animated.View>
    </View>
  );
}

function SwipeDemo({ clock, seg, marker }: { clock: Animated.Value; seg: Seg; marker: Marker }) {
  const tint = useTint();
  const LOW = 16;
  const HIGH = -30;
  const y = track(clock, seg, [[0, LOW], [0.14, LOW], [0.62, HIGH, smooth], [0.8, HIGH - 6, Easing.out(Easing.quad)], [0.84, LOW], [1, LOW]]);
  const scale = track(clock, seg, [[0, 1], [0.08, 1], [0.14, 0.92, press], [0.62, 0.92], [0.72, 1, springy], [1, 1]]);
  // Lifts off and fades at the top, comes back at the bottom unseen.
  const opacity = track(clock, seg, [[0, 1], [0.66, 1], [0.8, 0, Easing.in(Easing.quad)], [0.84, 0], [1, 1, Easing.out(Easing.quad)]]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      {marker === 'dot' ? (
        <Animated.View style={[styles.dot, tint.dot, { transform: [{ translateY: y }, { scale }] }]} />
      ) : (
        <Touch marker="pointer" mouse={false} y={y} scale={scale} />
      )}
    </Animated.View>
  );
}

/** Reduce Motion: the gestures' icons, still. */
function StillIcons({ steps, input, size, shadow }: { steps: Step[]; input: HintInputKind; size: number; shadow?: boolean }) {
  const c = usePalette();
  const icon = (st: Step): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    if (st === 'swipe') return 'gesture-swipe-up';
    if (input.mouse) return st === 'hold' && input.spaceKey ? 'keyboard-space' : 'mouse';
    return st === 'doubleTap' ? 'gesture-double-tap' : 'gesture-tap-hold';
  };
  return (
    <>
      {steps.map((st) => (
        <Fragment key={st}>
          <MaterialCommunityIcons name={icon(st)} size={size} color={c.text} style={shadow && styles.iconShadow} />
        </Fragment>
      ))}
    </>
  );
}

// ---- styles ---------------------------------------------------------------------

function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const useTint = themed((c: Palette) => ({
  glass: {
    backgroundColor: alpha(c.bg, 0.34),
    borderColor: alpha(c.text, 0.12),
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as object) : null),
  },
  caption: { color: c.text },
  // A dark halo keeps the bare marks readable over bright video.
  ripple: { borderColor: alpha(c.text, 0.9), boxShadow: '0 0 6px rgba(0,0,0,0.35)' },
  ringTrack: { borderColor: alpha(c.bg, 0.35) },
  ringFill: { borderColor: c.accent },
  dot: { backgroundColor: alpha(c.text, 0.95), boxShadow: '0 1px 8px rgba(0,0,0,0.45)' },
  key: { backgroundColor: alpha(c.text, 0.1), borderColor: alpha(c.text, 0.6) },
  keyBase: { backgroundColor: alpha(c.text, 0.18) },
  keyFill: { backgroundColor: alpha(c.accent, 0.5) },
}));

const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

const PILL_W = 176;
const GLYPH = 48;
/** The mini demos are the tile's, shrunk into the pill's glyph. */
const MINI = 0.46;

/** Where a demo's drawing is centred, in the tile's height: the space bar on TARGET, a hand reaching below it. */
function focusOf(st: Step, input: HintInputKind): number {
  if (st === 'hold' && input.mouse && input.spaceKey) return TARGET.y + 2;
  if (input.mouse && st !== 'swipe') return TARGET.y + 10;
  return TARGET.y + 18;
}

/** The tile-sized demo box, shrunk about its centre so `focusY` lands on the glyph's centre. */
function miniStage(focusY: number): ViewStyle {
  return {
    position: 'absolute',
    left: GLYPH / 2 - TILE / 2,
    top: GLYPH / 2 - TILE / 2 - (focusY - TILE / 2) * MINI,
    width: TILE,
    height: TILE,
    transform: [{ scale: MINI }],
  };
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  tile: { width: TILE, height: TILE },
  tileGlass: { borderRadius: 34, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  caption: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 18,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    ...textShadow,
  },
  // The ring design has no tile: the caption sits closer under the ring, with a stronger shadow.
  captionBare: { bottom: 34, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
  iconShadow: textShadow,
  // The glyph's fingertip sits about 0.42 across and 0.08 down its box.
  hand: { position: 'absolute', left: TARGET.x - HAND * 0.42, top: TARGET.y - HAND * 0.08 },
  // The arrow's tip sits about 0.27 across and 0.12 down its box.
  cursor: { position: 'absolute', left: TARGET.x - 34 * 0.27, top: TARGET.y - 34 * 0.12 },
  dot: { position: 'absolute', left: TARGET.x - 9, top: TARGET.y - 9, width: 18, height: 18, borderRadius: 9 },
  ripple: {
    position: 'absolute',
    left: TARGET.x - 20,
    top: TARGET.y - 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  ringWrap: { position: 'absolute', left: TARGET.x - RING / 2, top: TARGET.y - RING / 2, width: RING, height: RING },
  ringBox: { position: 'absolute', left: 0, top: 0, width: RING, height: RING },
  ring: { position: 'absolute', top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: STROKE },
  halfClip: { position: 'absolute', top: 0, width: RING / 2, height: RING, overflow: 'hidden' },
  keyWrap: { position: 'absolute', left: (TILE - KEY_W) / 2, top: TARGET.y - KEY_H / 2, width: KEY_W, height: KEY_H + 3 },
  keyBase: { position: 'absolute', left: 0, right: 0, top: 3, height: KEY_H, borderRadius: 9 },
  key: { position: 'absolute', left: 0, right: 0, top: 0, height: KEY_H, borderRadius: 9, borderWidth: 1.5, overflow: 'hidden' },
  keyFill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: KEY_W },
  stillRow: { flexDirection: 'row', gap: 14, alignItems: 'center', justifyContent: 'center', height: TILE - 40, paddingTop: 10 },
  // Low on the clip, clear of the centre where the video's subject usually is.
  pillLane: { position: 'absolute', left: 0, right: 0, top: '62%', alignItems: 'center' },
  pill: {
    minWidth: PILL_W,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 16,
    gap: 8,
  },
  glyph: { width: GLYPH, height: GLYPH, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  // Room for the longest caption, so the pill keeps its size as the words change.
  pillWords: { width: 100, height: 20, justifyContent: 'center' },
  pillCaption: { position: 'absolute', left: 0, right: 0, fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  pillCaptionStill: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
});
