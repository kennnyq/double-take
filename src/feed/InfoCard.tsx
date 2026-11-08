import { useEffect, useState } from 'react';
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
import type { CardSpot } from './card';
import { alpha, useGlass } from './glass';
import { ownLayer } from './layer';
import { revealFrame, SIRI, type RevealVariant } from './reveal';
import { RevealText } from './RevealText';

interface Props {
  spot: CardSpot;
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
 * The double take's info card. The card fades in with a short springy move
 * from its side of the subject (rising from below when it sits under it,
 * dropping from above when over it) and leaves the same way, faster.
 *
 * The text comes in the way Siri's answer card does: line after line rising
 * from below, the gaps between them closing up, the words fading in in reading
 * order (see reveal.ts). It starts while the card is still settling, and
 * leaves in reverse. One timeline drives it
 * on the UI thread (see RevealText and reveal.ts).
 *
 * Everything animates transform and opacity only; nothing is laid out again
 * while the card moves.
 */
export function InfoCard({ spot, text, hint, loop, blur, nav, revealVariant, leaving, onGone }: Props) {
  const g = useGlass();
  const W = spot.width;
  const down = spot.from === 'above' ? -1 : 1;
  // The reveal's length, once the text's lines are known; nothing shows until then.
  const [total, setTotal] = useState(0);

  const card = useSharedValue(0); // 0: away, 1: in place (springs past 1 a little)
  const shown = useSharedValue(0); // opacity
  const clock = useSharedValue(0); // ms into the text's reveal

  useEffect(() => {
    if (leaving) {
      // The text runs back (last words first), gently, as the card goes.
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
    // onGone is stable per card (keyed by the overlay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, total]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - card.value) * TRAVEL * down }, { scale: 0.96 + 0.04 * card.value }],
  }));

  return (
    <Animated.View
      style={[styles.card, ownLayer, { width: W, left: spot.cx - W / 2 }, spot.side === 'top' ? { top: spot.offset } : { bottom: spot.offset }, cardStyle]}
      pointerEvents={nav && !leaving ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      testID="dt-card"
    >
      <View style={[StyleSheet.absoluteFill, styles.glass, g.glass, blur ? g.tint : g.tintSolid]} pointerEvents="none">
        {blur ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      </View>
      <Animated.View style={styles.content} pointerEvents="box-none" accessible accessibilityLabel={hint ? `${text}. ${hint}` : text}>
        <RevealText
          text={text}
          hint={hint}
          textStyle={[styles.text, g.text]}
          hintStyle={[styles.hint, g.hint]}
          clock={clock}
          onReady={setTotal}
          variant={revealVariant}
        />
        {nav ? (
          <Footer nav={nav} loop={loop ?? null} clock={clock} start={footerStart(total, revealVariant)} />
        ) : loop ? (
          <View style={styles.soloProgress}>
            <FooterItem clock={clock} start={footerStart(total, revealVariant)}>
              <LoopLine loop={loop} />
            </FooterItem>
          </View>
        ) : (
          <View style={styles.lineSpace} />
        )}
      </Animated.View>
    </Animated.View>
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
  const done = last && nav.cue === 'done';
  return (
    <View style={styles.footer} pointerEvents="box-none">
      <View style={styles.statusSpace} pointerEvents="none">
        <FooterItem clock={clock} start={start}>
          <View style={styles.status}>
            {loop ? <LoopLine loop={loop} /> : null}
            {nav.cue === 'dots' ? (
              <View style={styles.dots}>
                {Array.from({ length: nav.count }, (_, i) => (
                  <View key={i} style={[styles.dot, i <= nav.step ? t.dotOn : t.dot, i === nav.step && styles.dotNow]} />
                ))}
              </View>
            ) : null}
            {nav.cue === 'count' ? <Text style={[styles.count, t.count]}>{`${nav.step + 1} / ${nav.count}`}</Text> : null}
          </View>
        </FooterItem>
      </View>
      <View style={styles.arrows} pointerEvents="box-none">
        <FooterItem clock={clock} start={start + 12}>
          <NavButton icon="chevron-back" label="Previous tell" disabled={nav.step === 0} onPress={nav.onBack} />
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
      </View>
    </View>
  );
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
  const t = useNavTint();
  const c = usePalette();
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      hitSlop={{ top: 7, bottom: 7, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: !!p.disabled }}
      style={({ pressed }) => [styles.navBtn, p.filled ? t.navFilled : t.nav, p.disabled && styles.navOff, pressed && styles.navPressed]}
    >
      <Ionicons name={p.icon} size={16} color={p.color ?? alpha(c.text, 0.85)} />
    </Pressable>
  );
}

const useNavTint = themed((c) => ({
  nav: { backgroundColor: alpha(c.text, 0.1) },
  navFilled: { backgroundColor: c.tell },
  dot: { backgroundColor: alpha(c.text, 0.22) },
  dotOn: { backgroundColor: alpha(c.text, 0.75) },
  count: { color: alpha(c.textDim, 0.85) },
}));

/** A short, faint line under the text that fills as the slow-mo loop plays; it restarts with the loop. */
function LoopLine({ loop }: { loop: SharedValue<number> }) {
  const g = useGlass();
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(1, Math.max(0, loop.value)) }] }));
  return (
    <View style={[styles.track, g.track]}>
      <Animated.View style={[styles.fill, g.fill, ownLayer, fill]} />
    </View>
  );
}

const LINE_W = 56;

const styles = StyleSheet.create({
  card: { position: 'absolute' },
  // Clips (it holds at most a blur view) so iOS draws its hairline border with
  // Core Animation rather than into a bitmap.
  glass: { borderRadius: 22, overflow: 'hidden' },
  content: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 9 },
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
  soloProgress: { marginTop: 9 },
  statusSpace: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  arrows: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: { width: 44, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  navOff: { opacity: 0.3 },
  navPressed: { opacity: 0.6 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dotNow: { transform: [{ scale: 1.3 }] },
  count: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
