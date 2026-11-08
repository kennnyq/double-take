import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { themed, usePalette } from '@/ui/theme';
import type { DesignId } from '../designs';
import { NATIVE, blurStyle, lerp, type AnimNum } from '../motion';
import type { Anchor } from './Hud';
import { ProgressRing } from './ProgressRing';

export type CountdownDesign = DesignId<'countdown'>;

interface Props {
  design: CountdownDesign;
  /** When the countdown ends (`performance.now()`); null holds it at the start. */
  endAt: number | null;
  totalMs: number;
  width: number;
  height: number;
  /** Where the timer sits: the countdown lands there as it ends. */
  anchor: Anchor;
  /** 0 at the centre, 1 landed in the timer (and gone). Runs both ways: a resume flies back out. */
  morph: AnimNum;
  /** 0..1: shown at all (hidden before Start and while paused). */
  shown: AnimNum;
}

const BOX = 148;
const NUMBERS = [3, 2, 1] as const;

/**
 * 3-2-1 before play, in one of the trial designs. Every design is driven by
 * one linear value over the whole countdown, so nothing steps, and every
 * design ends the same way: it flies to the timer's place and shrinks into
 * it while the timer grows out of it.
 */
export function Countdown({ design, endAt, totalMs, width, height, anchor, morph, shown }: Props) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (endAt === null) {
      t.setValue(0);
      return;
    }
    const left = Math.min(totalMs, Math.max(0, endAt - performance.now()));
    t.setValue(1 - left / totalMs);
    const a = Animated.timing(t, { toValue: 1, duration: left, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t, endAt, totalMs]);

  const cx = width / 2;
  const cy = height / 2;
  // Each design's own size to land at in the timer.
  const landing = design === 'roll' ? anchor.h / ROLL_H : Math.max(anchor.h, 24) / BOX;
  const box = design === 'roll' ? { w: ROLL_W, h: ROLL_H } : { w: BOX, h: BOX };
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="timer"
      accessibilityLabel="Starting"
      testID="game-countdown"
      style={[
        styles.box,
        {
          left: cx - box.w / 2,
          top: cy - box.h / 2,
          width: box.w,
          height: box.h,
          opacity: Animated.multiply(shown, lerp(morph, [0, 0.5, 1], [1, 0.85, 0])),
          transform: [
            { translateX: lerp(morph, [0, 1], [0, anchor.cx - cx]) },
            { translateY: lerp(morph, [0, 1], [0, anchor.cy - cy]) },
            { scale: lerp(morph, [0, 1], [1, landing]) },
          ],
        },
      ]}
    >
      {design === 'ring' && <RingCountdown t={t} />}
      {design === 'resolve' && <ResolveCountdown t={t} />}
      {design === 'roll' && <RollCountdown t={t} />}
    </Animated.View>
  );
}

/** Ring: one sweep round over the whole countdown; the numbers crossfade and shrink into each other. */
function RingCountdown({ t }: { t: Animated.Value }) {
  const c = usePalette();
  const tint = useTint();
  return (
    <>
      <ProgressRing progress={t} size={BOX} stroke={6} color={c.accent} track="rgba(255,255,255,0.16)" />
      {NUMBERS.map((n, i) => {
        const a = i / 3;
        const b = (i + 1) / 3;
        const e = 0.08;
        // The last number stays: it's what lands in the timer.
        const out = i === 2 ? [1, 1] : [1, 0];
        return (
          <Animated.Text
            key={n}
            style={[
              styles.number,
              tint.number,
              {
                opacity: lerp(t, [a - e, a + e * 0.5, b - e * 0.5, b + e], [0, 1, out[0], out[1]]),
                transform: [{ scale: lerp(t, [a - e, b + e], [1.25, i === 2 ? 1 : 0.8]) }],
              },
            ]}
          >
            {n}
          </Animated.Text>
        );
      })}
    </>
  );
}

/**
 * Resolve: each number comes in like the double take's text, from faint,
 * slightly low and blurred to sharp in about a quarter of a second, holds,
 * then dissolves as the next one resolves. The 1 stays and flies into the timer.
 */
function ResolveCountdown({ t }: { t: Animated.Value }) {
  const tint = useTint();
  return (
    <>
      {NUMBERS.map((n, i) => {
        const a = i / 3;
        const b = (i + 1) / 3;
        // ~240 ms of a 1 s step to resolve, eased out.
        const inEnd = a + 0.08;
        const last = i === 2;
        const resolve = lerp(t, [a - 0.01, a + 0.02, a + 0.05, inEnd], [0, 0.55, 0.88, 1]);
        const dissolve = last ? lerp(t, [0, 1], [0, 0]) : lerp(t, [b - 0.05, b + 0.02], [0, 1]);
        const blur = Animated.add(lerp(resolve, [0, 1], [1, 0]), dissolve);
        return (
          <Animated.Text
            key={n}
            style={[
              styles.number,
              styles.resolveNumber,
              tint.number,
              {
                opacity: Animated.multiply(resolve, lerp(dissolve, [0, 1], [1, 0])),
                transform: [
                  { translateY: Animated.add(lerp(resolve, [0, 1], [14, 0]), lerp(dissolve, [0, 1], [0, -10])) },
                  { scale: Animated.add(lerp(resolve, [0, 1], [1.08, 1]), lerp(dissolve, [0, 1], [0, 0.12])) },
                ],
              },
              blurStyle(blur, 14),
            ]}
          >
            {n}
          </Animated.Text>
        );
      })}
    </>
  );
}

const ROLL_W = 176;
const ROLL_H = 76;

/** Roll: a pill that fills over the countdown while 3-2-1 rolls past like an odometer. */
function RollCountdown({ t }: { t: Animated.Value }) {
  const tint = useTint();
  // Hold each number, then roll to the next over the last fifth of its second.
  const y = lerp(t, [0, 0.27, 0.333, 0.6, 0.666, 1], [0, 0, -ROLL_H, -ROLL_H, -ROLL_H * 2, -ROLL_H * 2]);
  return (
    <View style={[styles.roll, tint.roll]}>
      <Animated.View style={[styles.rollFill, tint.rollFill, { transform: [{ translateX: lerp(t, [0, 1], [-ROLL_W, 0]) }] }]} />
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        {NUMBERS.map((n) => (
          <Text key={n} style={[styles.rollNumber, tint.number]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  number: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 64,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: BOX,
  },
  resolveNumber: { fontSize: 92, fontWeight: '900' },
  roll: {
    width: ROLL_W,
    height: ROLL_H,
    borderRadius: ROLL_H / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  rollFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  rollNumber: { height: ROLL_H, lineHeight: ROLL_H, fontSize: 44, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
});

const useTint = themed((c) => ({
  number: { color: c.text },
  roll: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentSoft },
  rollFill: { backgroundColor: c.accentSoft },
}));
