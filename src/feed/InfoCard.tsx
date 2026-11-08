import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { EndCue } from '@/devtools/settings';
import { themed, usePalette } from '@/ui/theme';
import { pointerVerb } from '@/ui/pointer';
import type { CardSpot } from './card';
import { alpha, useGlass } from './glass';
import { ownLayer } from './layer';
import { revealFrame, SIRI, type RevealVariant } from './reveal';
import { RevealText } from './RevealText';

interface Props {
  spot: CardSpot;
  stageH: number;
  text: string;
  /** Faint line under the text, e.g. "Tap to continue". */
  hint?: string;
  /** The slow-mo loop's progress (0..1), drawn as a faint line; none for cards without a loop. */
  loop?: SharedValue<number> | null;
  /** Live blur behind the glass (only with the spotlight's full blur: it's expensive over video). */
  blur?: boolean;
  /** Back and forward buttons along the bottom (walkthrough steps). */
  nav?: CardNav;
  /** How the text comes in (dev settings → Double take → Text); Siri's way by default. */
  revealVariant?: RevealVariant;
  /** Set to play the exit; `onGone` follows once it's done. */
  leaving: boolean;
  onGone: () => void;
}

export interface CardNav {
  /** This card's step (0-based) and how many there are. */
  step: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
  /** How the last step shows that the next tap ends the walkthrough. */
  cue: EndCue;
}

/** How far the card travels as it comes in (from its side of the subject) and leaves. */
const TRAVEL = 18;
/** Bubbly but quick: a little overshoot, settled in about 400 ms. */
const CARD_SPRING = { stiffness: 260, damping: 17, mass: 1 };
/** The text starts this long into the card's entrance, while the card is still settling. */
const TEXT_START_MS = 140;
/** Controls follow the text's last line by one line stagger, on the same clock. */
function footerStart(total: number, variant?: RevealVariant): number {
  return variant === 'wwdc' ? 100 : Math.max(0, total - SIRI.settle) + SIRI.lineStagger;
}

/**
 * One shell for the whole walkthrough. Its bottom row stays mounted while
 * the text exits and enters. Position and glass size retarget continuously;
 * only the glass scales, never the type or controls.
 */
export function InfoCard({ spot, stageH, text, hint, loop, blur, nav, revealVariant, leaving, onGone }: Props) {
  const g = useGlass();
  const [total, setTotal] = useState(0);
  const [textHeight, setTextHeight] = useState(20);
  const footerHeight = nav ? 40 : loop ? 11 : 4;
  const height = 13 + textHeight + footerHeight + 9;
  const bottom = spot.side === 'top' ? spot.offset + height : stageH - spot.offset;
  const card = useSharedValue(0);
  const shown = useSharedValue(0);
  // This clock belongs to the shell: it never restarts between tells.
  const clock = useSharedValue(0);
  // Animate the actual edges together. Deriving size from them prevents a
  // late height measurement from counteracting translation or restarting it.
  const bounds = useSharedValue([spot.cx - spot.width / 2, bottom - height, bottom]);
  const positioned = useRef(false);

  useEffect(() => {
    const target = [spot.cx - spot.width / 2, bottom - height, bottom];
    if (!positioned.current) {
      bounds.set(target);
      positioned.current = !!total;
    } else {
      // Physics springs inherit velocity when retargeted, unlike restarting
      // an ease-in-out timing curve every time text layout reports its size.
      bounds.set(withSpring(target, { stiffness: 320, damping: 36, mass: 1 }));
    }
  }, [spot.cx, spot.width, bottom, height, total, bounds]);

  useEffect(() => {
    if (leaving) {
      clock.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) });
      card.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) });
      shown.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(onGone)();
      });
      return;
    }
    if (!total) return;
    shown.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    card.value = withSpring(1, CARD_SPRING);
    const duration = Math.max(total, footerStart(total, revealVariant) + 24 + SIRI.settle);
    clock.value = withDelay(TEXT_START_MS, withTiming(duration, { duration, easing: Easing.linear }));
    // total is set only by the first text; subsequent text has its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, total]);

  const [direction] = useState(spot.from === 'above' ? -1 : 1);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: bounds.value[0] }, { translateY: bounds.value[2] - 60 + (1 - card.value) * TRAVEL * direction }, { scale: 0.96 + 0.04 * card.value }],
  }));
  const glassStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: (bounds.value[2] - bounds.value[1]) / 200 }],
  }));

  return (
    <Animated.View
      style={[styles.card, ownLayer, { width: spot.width }, cardStyle]}
      pointerEvents={nav && !leaving ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      testID="dt-card"
    >
      <Animated.View testID="dt-card-glass" style={[styles.glass, ownLayer, g.glass, blur ? g.tint : g.tintSolid, glassStyle]} pointerEvents="none">
        {blur ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      </Animated.View>
      <View style={[styles.copy, { bottom: footerHeight + 9 }]} pointerEvents="none">
        <CardText
          text={text} hint={hint} step={nav?.step} variant={revealVariant} leaving={leaving}
          onReady={(duration) => setTotal((old) => old || duration)}
          onHeight={setTextHeight}
        />
      </View>
      <View style={styles.bottom} pointerEvents="box-none">
        {nav ? (
          <Footer nav={nav} loop={loop ?? null} clock={clock} start={footerStart(total, revealVariant)} />
        ) : (
          <FooterItem clock={clock} start={footerStart(total, revealVariant)}>
            {loop ? <LoopLine loop={loop} /> : <View style={styles.lineSpace} />}
          </FooterItem>
        )}
      </View>
    </Animated.View>
  );
}

/** Exit the old copy before mounting new copy, even when the user changes direction mid-transition. */
function CardText({ text, hint, step, variant, leaving, onReady, onHeight }: {
  text: string; hint?: string; step?: number; variant?: RevealVariant; leaving: boolean;
  onReady: (duration: number) => void; onHeight: (height: number) => void;
}) {
  const g = useGlass();
  const target = JSON.stringify([text, hint, step, variant]);
  const [displayed, setDisplayed] = useState({ key: target, text, hint, variant });
  const clock = useSharedValue(0);
  const measureClock = useSharedValue(0);
  const ready = useRef(0);
  const first = useRef(true);
  const previousTarget = useRef(target);
  const heights = useRef(new Map<string, number>());
  // A reversal can return to still-visible copy without a new layout event.
  // Restore its measured size rather than retaining the abandoned target's.
  useEffect(() => {
    const known = heights.current.get(target);
    if (known !== undefined) onHeight(known);
  }, [target, onHeight]);
  useEffect(() => {
    const reversed = previousTarget.current !== target;
    previousTarget.current = target;
    if (leaving || target !== displayed.key) {
      clock.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (done) => {
        if (done && !leaving) runOnJS(setDisplayed)({ key: target, text, hint, variant });
      });
    } else if (ready.current && reversed) {
      // Also handles a quick reversal back to the still-displayed text.
      clock.value = withTiming(ready.current, { duration: ready.current, easing: Easing.linear });
    }
    // The key contains all the copy and variant fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, displayed.key, leaving]);
  return (
    <>
    {target !== displayed.key && (
      <View key={target} style={styles.measureCopy} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
        onLayout={(e) => {
          heights.current.set(target, e.nativeEvent.layout.height);
          onHeight(e.nativeEvent.layout.height);
        }}>
        <RevealText text={text} hint={hint} variant={variant} textStyle={[styles.text, g.text]} hintStyle={[styles.hint, g.hint]}
          clock={measureClock} onReady={() => {}} />
      </View>
    )}
    <View onLayout={(e) => {
      heights.current.set(displayed.key, e.nativeEvent.layout.height);
      if (target === displayed.key) onHeight(e.nativeEvent.layout.height);
    }} accessible accessibilityLabel={displayed.hint ? `${displayed.text}. ${displayed.hint}` : displayed.text}>
      <RevealText
        key={displayed.key}
        text={displayed.text} hint={displayed.hint} variant={displayed.variant}
        textStyle={[styles.text, g.text]} hintStyle={[styles.hint, g.hint]}
        clock={clock}
        onReady={(duration) => {
          ready.current = duration;
          onReady(duration);
          if (!leaving) clock.set(withDelay(first.current ? TEXT_START_MS : 0, withTiming(duration, { duration, easing: Easing.linear })));
          first.current = false;
        }}
      />
    </View>
    </>
  );
}

/**
 * Playback status at the text's left edge; the paired arrows at the right.
 * Each piece rises with the text instead of waiting for it to finish.
 */
function Footer({ nav, loop, clock, start }: { nav: CardNav; loop: SharedValue<number> | null; clock: SharedValue<number>; start: number }) {
  const t = useNavTint();
  const c = usePalette();
  const last = nav.step + 1 >= nav.count;
  const done = last && (nav.cue === 'done' || nav.cue === 'both');
  const single = nav.count === 1;
  return (
    <View style={styles.footer} pointerEvents="box-none">
      <View style={styles.statusSpace} pointerEvents="none">
        <FooterItem clock={clock} start={start}>
          <View style={styles.status}>
            <LoopLine loop={loop} />
            {!single && (nav.cue === 'dots' || nav.cue === 'both') ? (
              <View style={styles.dots} testID="dt-step-dots">
                {Array.from({ length: nav.count }, (_, i) => (
                  <StepDot key={i} reached={i <= nav.step} current={i === nav.step} />
                ))}
              </View>
            ) : null}
            {!single && nav.cue === 'count' ? <Text style={[styles.count, t.count]}>{`${nav.step + 1} / ${nav.count}`}</Text> : null}
          </View>
        </FooterItem>
      </View>
      {single ? (
        <FooterItem clock={clock} start={start + 12}>
          <Pressable onPress={nav.onNext} accessibilityRole="button" accessibilityLabel="Finish the walkthrough" style={styles.finishPrompt}
            hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}>
            <Text style={[styles.hint, t.count, styles.finishText]}>{pointerVerb()} to finish</Text>
          </Pressable>
        </FooterItem>
      ) : <View style={styles.arrows} pointerEvents="box-none">
        <FooterItem clock={clock} start={start + 12}>
          <NavButton icon="chevron-back" label={nav.step === 0 ? "Replay this annotation" : "Previous tell"} onPress={nav.onBack} />
        </FooterItem>
        <FooterItem clock={clock} start={start + 24}>
          <NavButton
            icon={done ? 'checkmark' : 'chevron-forward'}
            label={last ? 'Finish the walkthrough' : 'Next tell'}
            filled={done}
            onPress={nav.onNext}
            color={done ? c.onTell : undefined}
          />
        </FooterItem>
      </View>}
    </View>
  );
}

function StepDot({ reached, current }: { reached: boolean; current: boolean }) {
  const c = usePalette();
  const color = alpha(c.text, reached ? 0.75 : 0.22);
  const fill = useSharedValue(color);
  const scale = useSharedValue(current ? 1.3 : 1);
  useEffect(() => {
    fill.set(withTiming(color, { duration: 180 }));
    scale.set(withTiming(current ? 1.3 : 1, { duration: 180 }));
  }, [color, current, fill, scale]);
  const look = useAnimatedStyle(() => ({ backgroundColor: fill.value, transform: [{ scale: scale.value }] }));
  return <Animated.View style={[styles.dot, look]} />;
}

/** Same gentle rise and settle as Siri text; reversing the clock also reverses the exit. */
function FooterItem({ clock, start, children }: { clock: SharedValue<number>; start: number; children: React.ReactNode }) {
  const look = useAnimatedStyle(() => {
    const f = revealFrame('siri', clock.value, { move: start, fade: start }, { lineHeight: 20, descent: 3.6 });
    return { opacity: f.opacity, transform: [{ translateY: f.translateY }] };
  });
  return <Animated.View style={[ownLayer, look]} pointerEvents="box-none">{children}</Animated.View>;
}

function NavButton(p: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
  color?: string;
}) {
  const c = usePalette();
  const checked = useSharedValue(p.icon === 'checkmark' ? 1 : 0);
  const opacity = useSharedValue(p.disabled ? 0.3 : 1);
  const pressed = useSharedValue(1);
  const background = useSharedValue(p.filled ? c.tell : alpha(c.text, 0.1));
  useEffect(() => {
    checked.set(withTiming(p.icon === 'checkmark' ? 1 : 0, { duration: 180 }));
    opacity.set(withTiming(p.disabled ? 0.3 : 1, { duration: 180 }));
    background.set(withTiming(p.filled ? c.tell : alpha(c.text, 0.1), { duration: 180 }));
  }, [p.icon, p.disabled, p.filled, c.tell, c.text, checked, opacity, background]);
  const buttonStyle = useAnimatedStyle(() => ({ opacity: opacity.value * pressed.value, backgroundColor: background.value }));
  const arrowStyle = useAnimatedStyle(() => ({ opacity: 1 - checked.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: checked.value }));
  return (
    <Pressable
      onPress={p.onPress}
      onPressIn={() => pressed.set(withTiming(0.6, { duration: 80 }))}
      onPressOut={() => pressed.set(withTiming(1, { duration: 140 }))}
      disabled={p.disabled}
      hitSlop={{ top: 7, bottom: 7, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: !!p.disabled }}
    >
      <Animated.View style={[styles.navBtn, buttonStyle]}>
        <Animated.View style={[styles.navIcon, arrowStyle]}>
          <Ionicons name={p.icon === 'chevron-back' ? 'chevron-back' : 'chevron-forward'} size={16} color={alpha(c.text, 0.85)} />
        </Animated.View>
        <Animated.View testID="dt-nav-check" style={[styles.navIcon, checkStyle]}>
          <Ionicons name="checkmark" size={16} color={c.onTell} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const useNavTint = themed((c) => ({
  count: { color: alpha(c.textDim, 0.85) },
}));

/** A short, faint line under the text that fills as the slow-mo loop plays; it restarts with the loop. */
function LoopLine({ loop }: { loop: SharedValue<number> | null }) {
  const g = useGlass();
  const visible = useSharedValue(loop ? 1 : 0);
  useEffect(() => { visible.set(withTiming(loop ? 1 : 0, { duration: 180 })); }, [loop, visible]);
  const trackStyle = useAnimatedStyle(() => ({ opacity: visible.value }));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(1, Math.max(0, loop?.value ?? 0)) }] }));
  return (
    <Animated.View style={[styles.track, g.track, trackStyle]}>
      <Animated.View style={[styles.fill, g.fill, ownLayer, fill]} />
    </Animated.View>
  );
}

const LINE_W = 56;

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 0, top: 0, height: 60 },
  // Clips (it holds at most a blur view) so iOS draws its hairline border with
  // Core Animation rather than into a bitmap.
  glass: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200, transformOrigin: 'bottom', borderRadius: 22, overflow: 'hidden' },
  measureCopy: { position: 'absolute', left: 0, right: 0, opacity: 0 },
  copy: { position: 'absolute', left: 16, right: 16 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 9 },
  text: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  track: {
    width: LINE_W,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  // Scaled from its centre: centre it on the track's left end first.
  fill: { width: LINE_W * 2, height: 2, marginLeft: -LINE_W },
  lineSpace: { height: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 },
  statusSpace: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  finishPrompt: { height: 30, justifyContent: 'center' },
  finishText: { marginTop: 0 },
  arrows: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: { width: 44, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  navIcon: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  count: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
