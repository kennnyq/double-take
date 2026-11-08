import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDevPanel } from '@/devtools/store';
import { useAppSettings, useSettingsOpen } from '@/settings/store';
import { themed, usePalette, type Palette } from '@/ui/theme';
import { demoCaption, demoSteps, HINT_TIMEOUT_MS, SHOW_DELAY_MS, type DemoStep, type HintEnd, type HintKind } from './hints';
import { hints, useHints } from './store';
import './dev';

/**
 * A first-run hint over the active clip: a hand (or the mouse and keyboard,
 * with a fine pointer) showing how to open the double take, or, before that
 * for a brand-new viewer, how to swipe to the next clip. When it shows and
 * goes is decided in `hints.ts`; this draws it and reports what happened.
 *
 * Mount one in each clip of a feed; only the active one ever draws. It counts
 * the double takes opened on its clip from `doubleTakeOpen` going true.
 */
export interface GestureHintProps {
  clipId: string;
  active: boolean;
  hasTells: boolean;
  /** The double take is open on this clip. */
  doubleTakeOpen: boolean;
  /** Something else holds or covers the clip: it's paused, a panel is open… */
  blocked?: boolean;
  /** `phone`: the swipe hint, no Space key. `desktop`: Space holds. */
  layout: 'phone' | 'desktop';
  /** Fades the hint with the feed's chrome (the phone's sheets). */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
}

export function GestureHint(p: GestureHintProps) {
  const s = useHints();
  const settingsOpen = useSettingsOpen();
  const devOpen = useDevPanel().open;
  const { revealGesture } = useAppSettings();
  const fine = usePointerFine();
  const reduceMotion = useReduceMotion();
  const mouse = s.style === 'mouse' || (s.style === 'auto' && fine);
  const still = s.style === 'still' || reduceMotion;
  const covered = !p.active || p.doubleTakeOpen || !!p.blocked || settingsOpen || devOpen || s.blocks > 0;

  // What's drawn (kept through the fade-out) and whether it's on its way in.
  const [kind, setKind] = useState<HintKind | null>(null);
  const [on, setOn] = useState(false);
  const shown = useRef<HintKind | null>(null);
  // A hint that ran its course here doesn't start again on the same clip.
  const doneOn = useRef<string | null>(null);

  const hide = (why: HintEnd) => {
    const k = shown.current;
    if (!k) return;
    shown.current = null;
    if (why !== 'left') doneOn.current = p.clipId;
    hints.end(k, why);
    setOn(false);
  };

  useEffect(() => {
    if (p.active) hints.enterClip(p.clipId);
  }, [p.active, p.clipId]);

  // Opening a double take teaches the gesture, and is what the hint asks for.
  const wasOpen = useRef(p.doubleTakeOpen);
  useEffect(() => {
    if (p.doubleTakeOpen && !wasOpen.current && p.active) {
      hints.recordOpen();
      if (shown.current === 'doubleTake') hide('gesture');
    }
    wasOpen.current = p.doubleTakeOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doubleTakeOpen]);

  // A reset or a forced hint starts over, even on this clip.
  useEffect(() => {
    doneOn.current = null;
  }, [s.epoch]);

  // Covered or left: fade out, and it may come back on a later clip.
  useEffect(() => {
    if (covered) hide('left');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered]);

  // A clip that stays put for a moment gets the hint it should have.
  useEffect(() => {
    if (covered || on || doneOn.current === p.clipId) return;
    const t = setTimeout(() => {
      const k = hints.hintFor({ clipId: p.clipId, hasTells: p.hasTells, blocked: false, canSwipe: p.layout === 'phone' && !mouse });
      if (!k) return;
      hints.start(k);
      shown.current = k;
      setKind(k);
      setOn(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [covered, on, p.clipId, p.hasTells, p.layout, mouse, s.epoch, s.force]);

  // A couple of loops, then it goes by itself (a forced one stays, for looking at).
  useEffect(() => {
    if (!on || s.force !== 'off') return;
    const t = setTimeout(() => hide('timeout'), HINT_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, s.force]);

  // Gone for good on unmount (the clip scrolled out of the list).
  useEffect(
    () => () => hide('left'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Unmount the drawing once it has faded out, unless another hint started meanwhile.
  const onGone = useCallback(() => setKind((k) => (shown.current ? k : null)), []);

  if (!kind) return null;
  const steps: (DemoStep | 'swipe')[] = kind === 'swipe' ? ['swipe'] : demoSteps(revealGesture);
  return (
    <HintView
      steps={steps}
      mouse={mouse}
      spaceKey={p.layout === 'desktop'}
      still={still}
      on={on}
      opacity={p.opacity}
      onGone={onGone}
    />
  );
}

// ---- drawing ------------------------------------------------------------------

/** One pass of each demo, ms. */
const STEP_MS: Record<DemoStep | 'swipe', number> = { doubleTap: 2200, hold: 2800, swipe: 2100 };
/** The crossfade between demos, as a share of the whole loop on each side of the boundary. */
const XFADE = 0.04;

const TILE = 148;
/** Where the finger or pointer lands, in the tile. */
const TARGET = { x: TILE / 2, y: 48 };
const HAND = 56;

function HintView(props: {
  steps: (DemoStep | 'swipe')[];
  mouse: boolean;
  spaceKey: boolean;
  still: boolean;
  on: boolean;
  opacity?: GestureHintProps['opacity'];
  onGone: () => void;
}) {
  const { steps, still, on } = props;
  const tint = useTint();
  const [fade] = useState(() => new Animated.Value(0));
  const [clock] = useState(() => new Animated.Value(0));
  const total = steps.reduce((n, st) => n + STEP_MS[st], 0);
  const key = steps.join('+');

  const { onGone } = props;
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

  // Each demo gets its share of the loop, and is at rest while they crossfade.
  const bounds = [0];
  for (const st of steps) bounds.push(bounds[bounds.length - 1] + STEP_MS[st] / total);
  const input = { mouse: props.mouse, spaceKey: props.spaceKey };
  const scale = fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const caption = (st: DemoStep | 'swipe') => demoCaption(st, input);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, props.opacity !== undefined && { opacity: props.opacity }]}>
      <Animated.View
        style={[styles.tile, tint.tile, { opacity: fade, transform: [{ scale }] }]}
        testID="gesture-hint"
        accessible
        accessibilityRole="text"
        accessibilityLabel={steps.map(caption).join(', ')}
      >
        {still ? (
          <StillHint steps={steps} input={input} captions={steps.map(caption)} />
        ) : (
          steps.map((st, i) => {
            const seg: Seg = [bounds[i] + (steps.length > 1 ? XFADE : 0), bounds[i + 1] - (steps.length > 1 ? XFADE : 0)];
            return (
              <Fragment key={st}>
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: groupOpacity(clock, i, bounds) }]}>
                  <Demo step={st} clock={clock} seg={seg} input={input} />
                </Animated.View>
                <Animated.Text style={[styles.caption, tint.caption, { opacity: captionOpacity(clock, i, bounds) }]} numberOfLines={1}>
                  {caption(st)}
                </Animated.Text>
              </Fragment>
            );
          })
        )}
      </Animated.View>
    </Animated.View>
  );
}

type Seg = [number, number];
type Ease = (t: number) => number;
/** [local time 0–1, value, easing into this frame]. */
type Frame = [number, number, Ease?];

const smooth: Ease = Easing.inOut(Easing.cubic);
const press: Ease = Easing.out(Easing.quad);
const springy: Ease = Easing.out(Easing.back(2.2));

/**
 * A value over the loop: keyframes in the demo's own time, mapped into its
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

/** A demo's opacity in a loop of several: crossfading at each boundary, and across the loop's wrap. */
function groupOpacity(clock: Animated.Value, i: number, bounds: number[]) {
  const n = bounds.length - 1;
  if (n === 1) return 1;
  const pts: [number, number][] = [];
  const s = bounds[i];
  const e = bounds[i + 1];
  if (i === 0) pts.push([0, 0.5], [XFADE, 1]);
  else pts.push([0, i === n - 1 ? 0.5 : 0], [XFADE, 0], [s - XFADE, 0], [s + XFADE, 1]);
  if (i === n - 1) pts.push([1 - XFADE, 1], [1, 0.5]);
  else pts.push([e - XFADE, 1], [e + XFADE, 0], [1 - XFADE, 0], [1, 0.5]);
  // Dedupe the start for the last demo (it fades in at the boundary, not at 0).
  const clean = pts.filter((pt, k) => k === 0 || pt[0] > pts[k - 1][0]);
  return clock.interpolate({ inputRange: clean.map((pt) => pt[0]), outputRange: clean.map((pt) => pt[1]), extrapolate: 'clamp' });
}

/**
 * A demo's caption in a loop of several: one word fades out before the next
 * fades in, so two never overlap mid-fade.
 */
function captionOpacity(clock: Animated.Value, i: number, bounds: number[]) {
  if (bounds.length === 2) return 1;
  const s = bounds[i];
  const e = bounds[i + 1];
  return clock.interpolate({ inputRange: [s, s + XFADE, e - XFADE, e], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
}

function Demo({ step, clock, seg, input }: { step: DemoStep | 'swipe'; clock: Animated.Value; seg: Seg; input: { mouse: boolean; spaceKey: boolean } }) {
  if (step === 'swipe') return <SwipeDemo clock={clock} seg={seg} />;
  if (step === 'doubleTap') return <DoubleTapDemo clock={clock} seg={seg} mouse={input.mouse} />;
  if (input.mouse && input.spaceKey) return <SpaceDemo clock={clock} seg={seg} />;
  return <HoldDemo clock={clock} seg={seg} mouse={input.mouse} />;
}

/** The finger, or the mouse pointer, with its tip on TARGET. */
function Pointer({ mouse, style }: { mouse: boolean; style: Animated.WithAnimatedValue<ViewStyle> }) {
  const c = usePalette();
  return (
    <Animated.View style={[mouse ? styles.cursor : styles.hand, style]}>
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

const TAP1 = 0.22;
const TAP2 = 0.36;

function DoubleTapDemo({ clock, seg, mouse }: { clock: Animated.Value; seg: Seg; mouse: boolean }) {
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
      <Pointer mouse={mouse} style={{ transform: [{ translateY: y }, { scale }] }} />
    </>
  );
}

const DOWN = 0.16;
const FULL = 0.66;
const UP = 0.76;

function HoldDemo({ clock, seg, mouse }: { clock: Animated.Value; seg: Seg; mouse: boolean }) {
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
      <Pointer mouse={mouse} style={{ transform: [{ translateY: y }, { scale }] }} />
    </>
  );
}

const RING = 66;
const STROKE = 3;

/**
 * A ring that fills clockwise from the top as `progress` goes 0 → 1, without
 * SVG: each half clips a half ring that turns into view.
 */
function Ring({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
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

function SwipeDemo({ clock, seg }: { clock: Animated.Value; seg: Seg }) {
  const LOW = 16;
  const HIGH = -30;
  const y = track(clock, seg, [[0, LOW], [0.14, LOW], [0.62, HIGH, smooth], [0.8, HIGH - 6, Easing.out(Easing.quad)], [0.84, LOW], [1, LOW]]);
  const scale = track(clock, seg, [[0, 1], [0.08, 1], [0.14, 0.92, press], [0.62, 0.92], [0.72, 1, springy], [1, 1]]);
  // Lifts off and fades at the top, comes back at the bottom unseen.
  const opacity = track(clock, seg, [[0, 1], [0.66, 1], [0.8, 0, Easing.in(Easing.quad)], [0.84, 0], [1, 1, Easing.out(Easing.quad)]]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Pointer mouse={false} style={{ transform: [{ translateY: y }, { scale }] }} />
    </Animated.View>
  );
}

/** Reduce Motion: the gesture's icon and its words, still. */
function StillHint({
  steps,
  input,
  captions,
}: {
  steps: (DemoStep | 'swipe')[];
  input: { mouse: boolean; spaceKey: boolean };
  captions: string[];
}) {
  const c = usePalette();
  const tint = useTint();
  const icon = (st: DemoStep | 'swipe'): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    if (st === 'swipe') return 'gesture-swipe-up';
    if (input.mouse) return st === 'hold' && input.spaceKey ? 'keyboard-space' : 'mouse';
    return st === 'doubleTap' ? 'gesture-double-tap' : 'gesture-tap-hold';
  };
  return (
    <>
      <View style={styles.stillRow}>
        {steps.map((st) => (
          <MaterialCommunityIcons key={st} name={icon(st)} size={steps.length > 1 ? 40 : 52} color={c.text} />
        ))}
      </View>
      <Text style={[styles.caption, tint.caption]} numberOfLines={1}>
        {captions.join(' · ')}
      </Text>
    </>
  );
}

// ---- input and accessibility ------------------------------------------------------

/** A mouse or trackpad (web, `pointer: fine`), not the screen's width. */
function usePointerFine(): boolean {
  const [fine, setFine] = useState(() => matchFine()?.matches ?? false);
  useEffect(() => {
    const mq = matchFine();
    if (!mq) return;
    const on = () => setFine(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return fine;
}

function matchFine(): MediaQueryList | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia('(pointer: fine)');
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

// ---- styles ---------------------------------------------------------------------

function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const useTint = themed((c: Palette) => ({
  tile: {
    backgroundColor: alpha(c.bg, 0.34),
    borderColor: alpha(c.text, 0.12),
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as object) : null),
  },
  caption: { color: c.text },
  ripple: { borderColor: alpha(c.text, 0.9) },
  ringTrack: { borderColor: alpha(c.text, 0.22) },
  ringFill: { borderColor: c.accent },
  key: { backgroundColor: alpha(c.text, 0.1), borderColor: alpha(c.text, 0.6) },
  keyBase: { backgroundColor: alpha(c.text, 0.18) },
  keyFill: { backgroundColor: alpha(c.accent, 0.5) },
}));

const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 34,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
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
  iconShadow: textShadow,
  // The glyph's fingertip sits about 0.42 across and 0.08 down its box.
  hand: { position: 'absolute', left: TARGET.x - HAND * 0.42, top: TARGET.y - HAND * 0.08 },
  // The arrow's tip sits about 0.27 across and 0.12 down its box.
  cursor: { position: 'absolute', left: TARGET.x - 34 * 0.27, top: TARGET.y - 34 * 0.12 },
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
});
