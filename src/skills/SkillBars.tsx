import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { themed } from '@/ui/theme';
import { NATIVE, lerp } from '@/game/motion';
import { CATEGORY_INFO, type SkillCategory } from './categories';
import { generalSkill, toScore, type Belief, type Skills } from './skill';

interface Props {
  skills: Skills;
  /** Before a round: each bar grows (or shrinks) from here to `skills`, and shows the change. */
  before?: Skills;
  /** The categories to show, in order. */
  categories: readonly SkillCategory[];
  /** Highlighted (the round tested them). */
  touched?: readonly SkillCategory[];
  /** Starts the motion after this long. */
  delay?: number;
  /** The general score's own estimate (and before the round); else worked out from the categories. */
  general?: { now: Belief; before?: Belief };
}

const DURATION = 900;

/**
 * The player's scores: the general one large, then one bar per category.
 * A score is the chance of getting an average clip right (50 is guessing);
 * the faint band around each bar's end is the uncertainty, narrowing with
 * answers. Bars move from their old value to the new one, never jump.
 */
export function SkillBars({ skills, before, categories, touched, delay = 0, general: overall }: Props) {
  const tint = useTint();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    t.setValue(0);
    const a = Animated.timing(t, { toValue: 1, duration: DURATION, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t, skills, delay]);
  const general = toScore(overall?.now ?? generalSkill(skills));
  const generalBefore = overall ? (overall.before ? toScore(overall.before) : null) : before ? toScore(generalSkill(before)) : null;
  return (
    <View style={styles.root} testID="skill-bars">
      <View style={styles.generalRow}>
        <CountTo from={generalBefore?.score ?? general.score} to={general.score} delay={delay} style={[styles.general, tint.text]} label="General score" />
        <View style={styles.generalSide}>
          {generalBefore && generalBefore.score !== general.score ? <Delta value={general.score - generalBefore.score} /> : null}
          <Text style={[styles.band, tint.dim]}>
            {general.low}–{general.high}
          </Text>
        </View>
      </View>
      {categories.map((c) => {
        const s = skills[c];
        const now = toScore(s);
        const was = before ? toScore(before[c]) : now;
        const on = !touched || touched.includes(c);
        return (
          <View key={c} style={[styles.row, !on && styles.dim]} accessibilityLabel={`${CATEGORY_INFO[c].label}: ${s.n ? now.score : 'no answers yet'}`}>
            <Text style={[styles.label, tint.text]} numberOfLines={1}>
              {CATEGORY_INFO[c].label}
            </Text>
            <Bar t={t} from={was.score} to={now.score} low={now.low} high={now.high} empty={!s.n} />
            <Text style={[styles.value, tint.text]}>{s.n ? now.score : '–'}</Text>
            <View style={styles.deltaBox}>{before && now.score !== was.score ? <Delta value={now.score - was.score} /> : null}</View>
          </View>
        );
      })}
    </View>
  );
}

function Bar({ t, from, to, low, high, empty }: { t: Animated.Value; from: number; to: number; low: number; high: number; empty: boolean }) {
  const tint = useTint();
  const [w, setW] = useState(0);
  const x = (v: number) => (w * v) / 100;
  return (
    <View style={[styles.track, tint.track]} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {!empty && w > 0 && (
        <>
          <Animated.View style={[styles.band2, tint.band, { left: x(low), width: Math.max(2, x(high) - x(low)), opacity: lerp(t, [0.4, 1], [0, 0.55]) }]} />
          <View style={styles.clip}>
            <Animated.View style={[styles.fill, tint.fill, { width: w, transform: [{ translateX: lerp(t, [0, 1], [x(from) - w, x(to) - w]) }] }]} />
          </View>
        </>
      )}
      {/* Guessing: the 50 mark. */}
      {w > 0 && <View style={[styles.mid, tint.mid, { left: w / 2 - 0.5 }]} />}
    </View>
  );
}

function Delta({ value }: { value: number }) {
  const tint = useTint();
  return (
    <Text style={[styles.delta, tint.dim]}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value)}
    </Text>
  );
}

/** A number that counts from one value to another, continuously. */
function CountTo({ from, to, delay, style, label }: { from: number; to: number; delay: number; style: object; label: string }) {
  const [shown, setShown] = useState(from);
  useEffect(() => {
    const v = new Animated.Value(from);
    const id = v.addListener(({ value }) => setShown(Math.round(value)));
    const a = Animated.timing(v, { toValue: to, duration: DURATION, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start(({ finished }) => finished && setShown(to));
    return () => {
      a.stop();
      v.removeListener(id);
    };
  }, [from, to, delay]);
  return (
    <Text style={style} accessibilityLabel={`${label} ${to}`} testID="general-score">
      {shown}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: 'stretch' },
  generalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 2 },
  general: { fontSize: 44, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 48 },
  generalSide: { paddingBottom: 6, gap: 2 },
  band: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dim: { opacity: 0.45 },
  label: { width: 64, fontSize: 13, fontWeight: '600' },
  track: { flex: 1, height: 8, borderRadius: 4 },
  clip: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 4, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  band2: { position: 'absolute', top: -2, bottom: -2, borderRadius: 6 },
  mid: { position: 'absolute', top: -2, bottom: -2, width: 1 },
  value: { width: 28, textAlign: 'right', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  deltaBox: { width: 36 },
  delta: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

const useTint = themed((c) => ({
  text: { color: c.text },
  dim: { color: c.textDim },
  track: { backgroundColor: c.surfaceRaised },
  fill: { backgroundColor: c.text },
  band: { backgroundColor: c.accentSoft },
  mid: { backgroundColor: c.textDim },
}));
