import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { clipKey } from '@/game/deck';
import { useFrame } from '@/game/frame';
import { ProgressRing } from '@/game/hud/ProgressRing';
import { NATIVE, lerp } from '@/game/motion';
import { loadDealableClips } from '@/game/playable';
import { ResolveText } from '@/game/ResolveText';
import { themed, usePalette } from '@/ui/theme';
import { CATEGORY_INFO, SKILL_CATEGORIES, type SkillCategory } from './categories';
import { SKILL_ICONS, SKILL_TIPS, milestones, weakestSkill } from './insights';
import { toScore, type Belief } from './skill';
import { Bar, CountTo } from './SkillBars';
import { useSkillState } from './store';
import { useScorableCategories } from './useScorable';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The Skills tab: the general score as a gauge with its likely range, how it
 * moved over your last answers, your streaks and milestones, then one row per
 * skill with a way to spot it and a clip you missed. Everything comes from
 * your own answers on this device. A button practises your weakest skill.
 */
export function SkillsView() {
  const frame = useFrame();
  const state = useSkillState();
  const { categories, coverage } = useScorableCategories();
  const tint = useTint();
  const c = usePalette();
  const width = Math.min(frame.width, 560) - 32;
  const unscored = SKILL_CATEGORIES.filter((k) => !categories.includes(k) && coverage[k] > 0);
  const general = toScore(state.overall);
  const weakest = weakestSkill(state.skills, categories, state.overall);
  const reached = milestones(state.stats);
  const clips = useClipsByKey();
  const accuracy = state.stats.answers ? Math.round((100 * state.stats.correct) / state.stats.answers) : null;

  // Everything settles in once, eased.
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration: 900, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t]);
  const rise = (from: number) => ({ opacity: lerp(t, [from, from + 0.5], [0, 1]), transform: [{ translateY: lerp(t, [from, from + 0.5], [10, 0]) }] });

  return (
    <ScrollView style={[styles.root, tint.root]} contentContainerStyle={[styles.body, { paddingTop: (frame.desktop ? 0 : frame.top) + 28 }]}>
      <View style={{ width, gap: 16 }}>
        <ResolveText on style={[styles.title, tint.text]}>
          Your skills
        </ResolveText>

        {/* The general score: a gauge, its likely range, and how it moved lately. */}
        <Animated.View style={[styles.card, tint.card, styles.hero, rise(0)]} testID="skill-bars">
          <Gauge t={t} score={general.score} low={general.low} high={general.high} />
          <View style={styles.heroSide}>
            <Text style={[styles.kicker, tint.dim]}>General</Text>
            <Text style={[styles.range, tint.text]} accessibilityLabel={`Likely between ${general.low} and ${general.high}`}>
              likely {general.low}–{general.high}
            </Text>
            <Spark history={state.history} />
            <View style={styles.stats}>
              <Stat value={state.stats.answers} label="judged" />
              <Stat value={accuracy === null ? '–' : `${accuracy}%`} label="right" />
              <Stat value={state.stats.bestStreak} label="best streak" icon={state.stats.streak >= 3 ? 'flame' : undefined} />
            </View>
          </View>
        </Animated.View>

        {state.stats.answers === 0 ? (
          <Animated.View style={rise(0.15)}>
            <Action icon="game-controller-outline" label="Play to find out" onPress={() => router.push('/play')} />
          </Animated.View>
        ) : weakest ? (
          <Animated.View style={rise(0.15)}>
            <Action icon={SKILL_ICONS[weakest] as IconName} label={`Practise ${CATEGORY_INFO[weakest].label}`} onPress={() => router.push({ pathname: '/play', params: { focus: weakest } })} />
          </Animated.View>
        ) : null}

        {reached.length > 0 && (
          <Animated.View style={[styles.chips, rise(0.25)]} accessibilityLabel={`Milestones: ${reached.map((m) => m.label).join(', ')}`}>
            {reached.map((m) => (
              <View key={m.id} style={[styles.chip, tint.chip]}>
                <Ionicons name={m.icon as IconName} size={13} color={c.text} />
                <Text style={[styles.chipText, tint.text]}>{m.label}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* One row per skill: its score and range, how to spot it, and a clip you missed. */}
        <Animated.View style={[styles.card, tint.card, styles.rows, rise(0.3)]}>
          {categories.map((k, i) => (
            <SkillRow key={k} k={k} skill={state.skills[k]} t={t} last={i === categories.length - 1} missed={(state.misses[k] ?? []).map((key) => clips.get(key)).find(Boolean)} />
          ))}
        </Animated.View>

        <Text style={[styles.note, tint.dim]}>
          {state.answers} answers{state.rounds ? ` · ${state.rounds} timed rounds` : ''}
          {unscored.length ? ` · not enough clips yet: ${unscored.map((k) => CATEGORY_INFO[k].label).join(', ')}` : ''}
        </Text>
      </View>
    </ScrollView>
  );
}

function SkillRow({ k, skill: s, t, missed, last }: { k: SkillCategory; skill: Belief; t: Animated.Value; missed?: Clip; last: boolean }) {
  const tint = useTint();
  const c = usePalette();
  const now = toScore(s);
  return (
    <View style={[styles.row, !last && [styles.rowRule, tint.rule]]} accessibilityLabel={`${CATEGORY_INFO[k].label}: ${s.n ? now.score : 'no answers yet'}`} testID={`skill-row-${k}`}>
      <View style={[styles.icon, tint.iconBg]}>
        <Ionicons name={SKILL_ICONS[k] as IconName} size={17} color={c.text} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.label, tint.text]} numberOfLines={1}>
            {CATEGORY_INFO[k].label}
          </Text>
          <Bar t={t} from={50} to={now.score} low={now.low} high={now.high} empty={!s.n} />
          <Text style={[styles.value, tint.text]}>{s.n ? now.score : '–'}</Text>
        </View>
        <Text style={[styles.tip, tint.dim]}>{SKILL_TIPS[k]}</Text>
      </View>
      {missed ? (
        <View style={[styles.thumb, tint.iconBg]} accessibilityLabel="A clip you missed">
          <Image source={missed.poster as ComponentProps<typeof Image>['source']} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
        </View>
      ) : null}
    </View>
  );
}

/** The general score on a ring: the score drawn round from the top, its likely range a faint arc behind it. */
function Gauge({ t, score, low, high }: { t: Animated.Value; score: number; low: number; high: number }) {
  const c = usePalette();
  const tint = useTint();
  const size = 132;
  const [band] = useState(() => new Animated.Value((high - low) / 100));
  useEffect(() => band.setValue((high - low) / 100), [band, high, low]);
  return (
    <View style={{ width: size, height: size }}>
      {/* The range: a faint ring from `low` to `high`, turned to start at `low`. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: lerp(t, [0.4, 1], [0, 1]), transform: [{ rotate: `${low * 3.6}deg` }] }]}>
        <ProgressRing progress={band} size={size} stroke={10} color={c.accentSoft} track="transparent" />
      </Animated.View>
      <ProgressRing progress={lerp(t, [0, 1], [0, score / 100])} size={size} stroke={4} color={c.text} track={c.surfaceRaised} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <CountTo from={50} to={score} delay={150} style={[styles.score, tint.text]} label="General score" />
      </View>
    </View>
  );
}

/** The general score after each of your last answers: a row of thin bars, 50 (guessing) as a faint line. */
function Spark({ history }: { history: readonly number[] }) {
  const tint = useTint();
  if (history.length < 2) return null;
  const H = 30;
  return (
    <View style={[styles.spark, { height: H }]} accessibilityLabel={`General score over your last ${history.length} answers`} testID="skill-history">
      <View style={[styles.sparkMid, tint.mid, { top: H / 2 }]} />
      {history.map((v, i) => (
        <View key={i} style={[styles.sparkBar, tint.bar, { height: Math.max(2, (H * v) / 100), opacity: 0.35 + (0.65 * (i + 1)) / history.length }]} />
      ))}
    </View>
  );
}

function Stat({ value, label, icon }: { value: number | string; label: string; icon?: IconName }) {
  const tint = useTint();
  const c = usePalette();
  return (
    <View style={styles.stat}>
      <View style={styles.statTop}>
        {icon ? <Ionicons name={icon} size={13} color={c.text} /> : null}
        <Text style={[styles.statValue, tint.text]}>{value}</Text>
      </View>
      <Text style={[styles.statLabel, tint.dim]}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const tint = useTint();
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.action, tint.action, pressed && styles.pressed]}>
      <Ionicons name={icon} size={18} color={c.onAccent} />
      <Text style={[styles.actionText, tint.onAction]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={c.onAccent} />
    </Pressable>
  );
}

/** The feed's clips by key, for posters of clips you missed (fetched once per session, no media checks). */
function useClipsByKey(): Map<string, Clip> {
  const [clips, setClips] = useState<Map<string, Clip>>(() => new Map());
  useEffect(() => {
    let live = true;
    void loadDealableClips().then((all) => live && setClips(new Map(all.map((cl) => [clipKey(cl), cl]))));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => clips, [clips]);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 28 },
  title: { fontSize: 28, fontWeight: '800' },
  card: { borderRadius: 18, padding: 18 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  heroSide: { flex: 1, gap: 6 },
  center: { alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  range: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 4 },
  sparkMid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  sparkBar: { flex: 1, maxWidth: 6, borderRadius: 1.5 },
  stats: { flexDirection: 'row', gap: 16, marginTop: 6 },
  stat: { gap: 1 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11.5 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 16, height: 48 },
  actionText: { flex: 1, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, height: 28 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  rows: { paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowRule: { borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, gap: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: 64, fontSize: 13.5, fontWeight: '700' },
  value: { width: 28, textAlign: 'right', fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tip: { fontSize: 12, lineHeight: 16 },
  thumb: { width: 36, height: 56, borderRadius: 8, overflow: 'hidden' },
  note: { fontSize: 12.5, lineHeight: 17 },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  text: { color: c.text },
  dim: { color: c.textDim },
  chip: { backgroundColor: c.surfaceRaised },
  iconBg: { backgroundColor: c.surfaceRaised },
  rule: { borderBottomColor: c.surfaceRaised },
  mid: { backgroundColor: c.textDim },
  bar: { backgroundColor: c.text },
  action: { backgroundColor: c.accent },
  onAction: { color: c.onAccent },
}));
