import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { themed } from '@/ui/theme';
import { NATIVE, lerp } from '../motion';

/**
 * Small charts for the lab's simulations: one measure each, a single neutral
 * series, an optional dashed reference line (the truth, or a target) named
 * by a direct label, and the last value labelled. They draw in from left to
 * right as one continuous sweep.
 */

interface Domain {
  min: number;
  max: number;
}

function useSweep(key: unknown, ms = 900) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    t.setValue(0);
    const a = Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t, key, ms]);
  return t;
}

function useSize() {
  const [s, set] = useState({ w: 0, h: 0 });
  return [s, (e: LayoutChangeEvent) => set({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })] as const;
}

function Frame({ title, value, children, onLayout }: { title: string; value?: string; children: React.ReactNode; onLayout: (e: LayoutChangeEvent) => void }) {
  const tint = useTint();
  return (
    <View style={styles.chart}>
      <View style={styles.head}>
        <Text style={[styles.title, tint.dim]}>{title}</Text>
        {value ? <Text style={[styles.value, tint.text]}>{value}</Text> : null}
      </View>
      <View style={[styles.plot, tint.plot]} onLayout={onLayout}>
        {children}
      </View>
    </View>
  );
}

/** A dashed horizontal reference line with its label. */
function RefLine({ y, w, label }: { y: number; w: number; label: string }) {
  const tint = useTint();
  const dashes = Math.max(0, Math.floor(w / 8));
  return (
    <View pointerEvents="none" style={[styles.ref, { top: y }]}>
      {Array.from({ length: dashes }, (_, i) => (
        <View key={i} style={[styles.dash, tint.ref, { left: i * 8 }]} />
      ))}
      <Text style={[styles.refLabel, tint.dim, tint.plot]}>{label}</Text>
    </View>
  );
}

/** A line over rounds (dots joined by segments), with an optional band and reference line. */
export function LineChart({ title, values, band, domain, refValue, refLabel, format = (v) => String(Math.round(v)), sweepKey }: {
  title: string;
  values: number[];
  band?: [number, number][];
  domain: Domain;
  refValue?: number;
  refLabel?: string;
  format?: (v: number) => string;
  sweepKey?: unknown;
}) {
  const tint = useTint();
  const [{ w, h }, onLayout] = useSize();
  const t = useSweep(sweepKey ?? values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? w / 2 : 6 + (i * (w - 12)) / (n - 1));
  const y = (v: number) => h - 6 - ((v - domain.min) / (domain.max - domain.min || 1)) * (h - 12);
  // The sweep reveals points in order.
  const shown = (i: number) => lerp(t, [i / Math.max(1, n), (i + 1) / Math.max(1, n)], [0, 1]);
  return (
    <Frame title={title} value={n ? format(values[n - 1]) : undefined} onLayout={onLayout}>
      {w > 0 && (
        <>
          {band?.map(([lo, hi], i) => (
            <Animated.View key={`b${i}`} style={[styles.bandBar, tint.band, { left: x(i) - 2, top: y(hi), height: Math.max(2, y(lo) - y(hi)), opacity: shown(i) }]} />
          ))}
          {refValue !== undefined && <RefLine y={y(refValue)} w={w} label={refLabel ?? ''} />}
          {values.slice(1).map((v, i) => {
            const x0 = x(i);
            const y0 = y(values[i]);
            const x1 = x(i + 1);
            const y1 = y(v);
            const len = Math.hypot(x1 - x0, y1 - y0);
            const angle = Math.atan2(y1 - y0, x1 - x0);
            return (
              <Animated.View
                key={`s${i}`}
                style={[
                  styles.segment,
                  tint.mark,
                  { width: len, left: (x0 + x1) / 2 - len / 2, top: (y0 + y1) / 2 - 1, opacity: shown(i + 1), transform: [{ rotate: `${angle}rad` }] },
                ]}
              />
            );
          })}
          {values.map((v, i) => (
            <Animated.View key={`d${i}`} style={[styles.dot, tint.mark, { left: x(i) - 3, top: y(v) - 3, opacity: shown(i) }]} />
          ))}
        </>
      )}
    </Frame>
  );
}

/** Bars over rounds from a baseline (0 or the domain's floor), with an optional reference line. */
export function BarChart({ title, values, domain, baseline = domain.min, refValue, refLabel, format = (v) => String(Math.round(v)), sweepKey }: {
  title: string;
  values: number[];
  domain: Domain;
  baseline?: number;
  refValue?: number;
  refLabel?: string;
  format?: (v: number) => string;
  sweepKey?: unknown;
}) {
  const tint = useTint();
  const [{ w, h }, onLayout] = useSize();
  const t = useSweep(sweepKey ?? values);
  const n = values.length;
  const slot = n ? (w - 8) / n : 0;
  const barW = Math.max(2, Math.min(14, slot - 2));
  const y = (v: number) => h - 4 - ((v - domain.min) / (domain.max - domain.min || 1)) * (h - 8);
  const y0 = y(baseline);
  return (
    <Frame title={title} value={n ? format(values[n - 1]) : undefined} onLayout={onLayout}>
      {w > 0 &&
        values.map((v, i) => {
          const top = Math.min(y(v), y0);
          const height = Math.max(2, Math.abs(y(v) - y0));
          const grow = lerp(t, [i / Math.max(1, n), Math.min(1, (i + 3) / Math.max(1, n))], [0, 1]);
          return (
            <Animated.View
              key={i}
              style={[
                styles.bar,
                tint.mark,
                {
                  left: 4 + i * slot + (slot - barW) / 2,
                  top,
                  width: barW,
                  height,
                  opacity: grow,
                  transform: [{ translateY: lerp(grow, [0, 1], [v >= baseline ? height / 2 : -height / 2, 0]) }, { scaleY: grow }],
                },
              ]}
            />
          );
        })}
      {w > 0 && refValue !== undefined && <RefLine y={y(refValue)} w={w} label={refLabel ?? ''} />}
    </Frame>
  );
}

const styles = StyleSheet.create({
  chart: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  value: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  plot: { height: 110, borderRadius: 10, overflow: 'hidden' },
  segment: { position: 'absolute', height: 2, borderRadius: 1 },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  bandBar: { position: 'absolute', width: 4, borderRadius: 2 },
  bar: { position: 'absolute', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  ref: { position: 'absolute', left: 0, right: 0, height: 1 },
  dash: { position: 'absolute', top: 0, width: 4, height: 1 },
  refLabel: { position: 'absolute', left: 6, top: -9, fontSize: 11, fontWeight: '700', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
});

const useTint = themed((c) => ({
  plot: { backgroundColor: c.surfaceRaised },
  mark: { backgroundColor: c.text },
  band: { backgroundColor: c.accentSoft },
  ref: { backgroundColor: c.textDim },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
