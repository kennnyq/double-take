import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from '../config';
import type { DesignId } from '../designs';
import { NATIVE, lerp, type AnimNum } from '../motion';
import { ProgressRing } from './ProgressRing';

export type HudDesign = DesignId<'hud'>;

/** The top row: where the timer and the round's buttons sit, from the stage's top edge. */
export const ROW_Y = 10;
export const ROW_H = 36;
/** Room the buttons on the right take (two 36 pt buttons and a gap), with the edge padding. */
export const BUTTONS_W = 14 + 36 * 2 + 6;

/** The timer's box in the stage, centre-based, for the countdown to land in. */
export interface Anchor {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const BAR_READOUT = 44;
const BAR_COUNT = 34;
const PILL_W = 124;
const PILL_H = 34;
const RING = 38;

export function hudAnchor(design: HudDesign, width: number, top: number): Anchor {
  const cy = top + ROW_Y + ROW_H / 2;
  if (design === 'pill') return { cx: width / 2, cy, w: PILL_W, h: PILL_H };
  if (design === 'ring') return { cx: 16 + RING / 2, cy, w: RING, h: RING };
  const x0 = 16;
  const x1 = width - BUTTONS_W - 8 - BAR_COUNT - 8 - BAR_READOUT - 8;
  return { cx: (x0 + x1) / 2, cy, w: Math.max(0, x1 - x0), h: 4 };
}

/** `m:ss`, rounding up so the readout shows 0:00 only at the end. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Time left as a fraction of the round (1 → 0), as an Animated value that
 * drains linearly to the deadline while the clock runs and holds still when
 * it doesn't. One value drives whichever timer design shows.
 */
export function useTimeFraction(remainingMs: number, deadline: number | null, durationMs: number): Animated.Value {
  const [frac] = useState(() => new Animated.Value(remainingMs / durationMs));
  useEffect(() => {
    const left = deadline === null ? remainingMs : Math.max(0, Math.min(remainingMs, deadline - performance.now()));
    frac.stopAnimation();
    frac.setValue(left / durationMs);
    if (deadline === null || left <= 0) return;
    const a = Animated.timing(frac, { toValue: 0, duration: left, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [frac, remainingMs, deadline, durationMs]);
  return frac;
}

interface Props {
  design: HudDesign;
  /** Time left, 1 → 0 (`useTimeFraction`). */
  frac: Animated.Value;
  durationMs: number;
  /** The readout, from the round's clock ticks. */
  displayMs: number;
  judged: number;
  width: number;
  top: number;
  /** 0..1: the timer grows in where the countdown lands (0 hidden). */
  appear: AnimNum;
}

/** The round's clock, in one of the trial designs. */
export function Hud({ design, frac, durationMs, displayMs, judged, width, top, appear }: Props) {
  const a = hudAnchor(design, width, top);
  const tint = useTint();
  const c = usePalette();
  const warn = GAME.warnMs / durationMs;
  // Eases from the timer's colour to the warning colour as the last stretch begins.
  const warnOpacity = frac.interpolate({ inputRange: [warn * 0.6, warn], outputRange: [1, 0], extrapolate: 'clamp' });
  const opacity = lerp(appear, [0.35, 1], [0, 1]);
  const grow = lerp(appear, [0.35, 1], [0.6, 1]);
  const label = `${Math.ceil(displayMs / 1000)} seconds left, ${judged} judged`;
  const count = (
    <View style={styles.count}>
      <Ionicons name="layers-outline" size={13} color={c.textDim} />
      <Text style={[styles.countText, tint.dim]}>{judged}</Text>
    </View>
  );

  if (design === 'bar') {
    return (
      <Animated.View
        style={[styles.row, { top: top + ROW_Y, left: a.cx - a.w / 2, width: a.w + 8 + BAR_READOUT + 8 + BAR_COUNT, opacity }]}
        accessibilityLabel={label}
        testID="game-timer"
      >
        <Animated.View style={[styles.track, tint.track, { width: a.w, transform: [{ scaleX: grow }] }]}>
          <Animated.View style={[styles.fill, tint.fill, { transform: [{ translateX: frac.interpolate({ inputRange: [0, 1], outputRange: [-a.w, 0] }) }] }]}>
            <Animated.View style={[StyleSheet.absoluteFill, tint.warn, { opacity: warnOpacity }]} />
          </Animated.View>
        </Animated.View>
        <Text style={[styles.clock, tint.text]}>{formatClock(displayMs)}</Text>
        {count}
      </Animated.View>
    );
  }

  if (design === 'pill') {
    return (
      <Animated.View
        style={[
          styles.pill,
          tint.pill,
          { left: a.cx - a.w / 2, top: a.cy - a.h / 2, width: a.w, height: a.h, opacity, transform: [{ scale: grow }] },
        ]}
        accessibilityLabel={label}
        testID="game-timer"
      >
        <Animated.View style={[styles.pillFill, tint.pillFill, { transform: [{ translateX: frac.interpolate({ inputRange: [0, 1], outputRange: [-a.w, 0] }) }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, tint.warn, { opacity: Animated.multiply(warnOpacity, 0.55) }]} />
        </Animated.View>
        <Text style={[styles.pillClock, tint.text]}>{formatClock(displayMs)}</Text>
        <View style={styles.pillCount}>{count}</View>
      </Animated.View>
    );
  }

  // ring
  return (
    <Animated.View
      style={[styles.ringRow, { left: a.cx - a.w / 2, top: a.cy - a.h / 2, opacity, transform: [{ scale: grow }] }]}
      accessibilityLabel={label}
      testID="game-timer"
    >
      <View style={[styles.ringBg, { width: RING, height: RING, borderRadius: RING / 2 }]}>
        <ProgressRing progress={frac} size={RING} stroke={3} color={c.text} track="rgba(255,255,255,0.18)" />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: warnOpacity }]}>
          <ProgressRing progress={frac} size={RING} stroke={3} color={c.danger} track="transparent" />
        </Animated.View>
        <Text style={[styles.ringText, tint.text]}>{Math.max(0, Math.ceil(displayMs / 1000))}</Text>
      </View>
      {count}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2 },
  clock: { width: BAR_READOUT, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  countText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: {
    position: 'absolute',
    borderRadius: PILL_H / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  pillClock: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pillCount: { position: 'absolute', right: 10 },
  ringRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  ringBg: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  ringText: { position: 'absolute', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

const useTint = themed((c) => ({
  track: { backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { backgroundColor: c.text },
  warn: { backgroundColor: c.danger },
  pill: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentSoft },
  pillFill: { backgroundColor: c.accentSoft },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
