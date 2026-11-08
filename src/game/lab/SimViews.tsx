import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Clip } from '@/data/clips';
import { features, featureLabel } from '@/engagement/feedOrder';
import { simulateViewer } from '@/engagement/simulate';
import type { RankInput } from '@/engagement/rank';
import { CATEGORY_INFO, SKILL_CATEGORIES, type SkillCategory } from '@/skills/categories';
import { loadMetas } from '@/skills/loadMeta';
import type { ClipMeta } from '@/skills/meta';
import { sigmoid } from '@/skills/skill';
import { ADAPTIVE_TARGET, simPool, simulate, trueAbility, type SimClip } from '@/skills/simulate';
import { themed } from '@/ui/theme';
import { clipKey } from '../deck';
import { BarChart, LineChart } from './SimCharts';

function useMetas(clips: Clip[]) {
  const [metas, setMetas] = useState<Map<string, ClipMeta> | null>(null);
  useEffect(() => {
    let live = true;
    loadMetas(clips).then((m) => live && setMetas(m));
    return () => {
      live = false;
    };
  }, [clips]);
  return metas;
}

export const BOTS = {
  novice: { label: 'Novice', base: -0.5 },
  average: { label: 'Average', base: 0.6 },
  expert: { label: 'Expert', base: 1.7 },
} as const;
export const WEAKNESS = {
  none: { label: 'No weak spot', cat: null },
  subject: { label: 'Weak on bodies', cat: 'subject' },
  real: { label: 'Weak on real', cat: 'real' },
} as const;

export interface SkillSimParams {
  bot: keyof typeof BOTS;
  weak: keyof typeof WEAKNESS;
  rounds: number;
  adaptive: boolean;
  /** 1: today's clips; 5: a catalog five times larger (synthetic copies with new difficulties). */
  scale: number;
}

/**
 * A bot with a known skill plays rounds; the charts show the app's estimate
 * finding its true score, the success rate per round against the adaptive
 * target, and the difficulty dealt, round by round.
 */
export function SkillsSim({ clips, params, width }: { clips: Clip[]; params: SkillSimParams; width: number }) {
  const metas = useMetas(clips);
  const tint = useTint();
  const pool = useMemo<SimClip[] | null>(() => {
    if (!metas) return null;
    const base = simPool(clips, (c) => {
      const m = metas.get(clipKey(c))!;
      return { cats: m.cats, prior: m.prior };
    });
    const copies: SimClip[] = [];
    // A larger catalog, with more variety than today's: copies whose difficulties spread twice as wide.
    for (let k = 1; k < params.scale; k++)
      for (const c of simPool(clips, (x) => ({ cats: metas.get(clipKey(x))!.cats, prior: 2 * metas.get(clipKey(x))!.prior }), 100 + k, 0.9)) copies.push({ ...c, id: `${c.id}~${k}` });
    return [...base, ...copies];
  }, [metas, clips, params.scale]);
  const bot = { base: BOTS[params.bot].base, ability: WEAKNESS[params.weak].cat ? { [WEAKNESS[params.weak].cat!]: BOTS[params.bot].base - 1.6 } : undefined };
  const rounds = useMemo(() => (pool ? simulate(pool, { ...bot, rounds: params.rounds, perRound: 24, adaptive: params.adaptive, seed: 21 }) : []), [pool, params, bot.base]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pool) return <Text style={[styles.note, tint.dim]}>Reading every clip’s tells…</Text>;
  const last = rounds[rounds.length - 1];
  const key = JSON.stringify(params);
  return (
    <ScrollView contentContainerStyle={[styles.sim, { width }]} testID="lab-sim-skills">
      <Text style={[styles.note, tint.dim]}>
        {pool.length} clips · 24 a round · {params.adaptive ? `adaptive, aiming at ${Math.round(ADAPTIVE_TARGET * 100)}% right` : 'shuffled'}
      </Text>
      <LineChart
        title="General score (estimate)"
        values={rounds.map((r) => r.estimate)}
        band={rounds.map((r) => [r.low, r.high])}
        domain={{ min: 0, max: 100 }}
        refValue={last?.truth}
        refLabel={`true ${last?.truth}`}
        sweepKey={key}
      />
      <BarChart
        title="Right this round"
        values={rounds.map((r) => r.success * 100)}
        domain={{ min: 0, max: 100 }}
        refValue={ADAPTIVE_TARGET * 100}
        refLabel="target"
        format={(v) => `${Math.round(v)}%`}
        sweepKey={key}
      />
      <BarChart
        title="Difficulty dealt (mean)"
        values={rounds.map((r) => r.dealt)}
        domain={{ min: -1.5, max: 1.5 }}
        baseline={0}
        refValue={0}
        refLabel="average clip"
        format={(v) => v.toFixed(2)}
        sweepKey={key}
      />
      <Text style={[styles.h, tint.dim]}>By category: estimate · true</Text>
      {SKILL_CATEGORIES.filter((c) => last?.categories[c] !== undefined).map((c) => (
        <View key={c} style={styles.catRow}>
          <Text style={[styles.catLabel, tint.text]}>{CATEGORY_INFO[c].label}</Text>
          <Text style={[styles.catValue, tint.text]}>{last.categories[c]}</Text>
          <Text style={[styles.catValue, tint.dim]}>{Math.round(100 * sigmoid(trueAbility(bot, c as SkillCategory)))}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export const TASTES = {
  bodies: { label: 'Loves bodies, skips real', taste: { 'cat:subject': 1.2, 'verdict:real': -0.6 } },
  text: { label: 'Loves text tells', taste: { 'cat:text': 1.2, 'cat:other': -0.4 } },
  real: { label: 'Loves real footage', taste: { 'verdict:real': 1.2, 'shape:landscape': 0.3 } },
} as const;

/** A simulated viewer: each session the ranker learns more of their taste; precision@10 against a random order. */
export function RankerSim({ clips, taste, sessions, width }: { clips: Clip[]; taste: keyof typeof TASTES; sessions: number; width: number }) {
  const metas = useMetas(clips);
  const tint = useTint();
  const result = useMemo(() => {
    if (!metas) return null;
    const items: RankInput[] = clips.filter((c) => c.sourceId).map((c) => ({ key: clipKey(c), features: features(c), likes: c.likes }));
    return simulateViewer(items, { taste: TASTES[taste].taste, sessions, perSession: 15, seed: 3 });
  }, [metas, clips, taste, sessions]);
  if (!result) return <Text style={[styles.note, tint.dim]}>Reading every clip’s tells…</Text>;
  const key = `${taste}-${sessions}`;
  const base = result.sessions.reduce((n, s) => n + s.baseline, 0) / Math.max(1, result.sessions.length);
  return (
    <ScrollView contentContainerStyle={[styles.sim, { width }]} testID="lab-sim-ranker">
      <Text style={[styles.note, tint.dim]}>
        {clips.filter((c) => c.sourceId).length} clips · watches the top 15 each session · every 5th slot explores
      </Text>
      <BarChart
        title="Enjoyed in the top 10"
        values={result.sessions.map((s) => s.precision * 100)}
        domain={{ min: 0, max: 100 }}
        refValue={base * 100}
        refLabel="random order"
        format={(v) => `${Math.round(v)}%`}
        sweepKey={key}
      />
      <Text style={[styles.h, tint.dim]}>Top of the feed now, and why</Text>
      {result.last.slice(0, 8).map((r, i) => (
        <View key={r.clip.key} style={styles.whyRow}>
          <Text style={[styles.pos, tint.dim]}>{i + 1}</Text>
          <Text style={[styles.why, tint.text]} numberOfLines={2}>
            {r.explored ? 'exploring · ' : ''}
            {r.reasons
              .filter((x) => x.value)
              .slice(0, 3)
              .map((x) => `${x.value > 0 ? '+' : '−'}${Math.abs(x.value).toFixed(2)} ${x.why.replace(/(cat|verdict|shape|tier|author):\S+/g, (f) => featureLabel(f))}`)
              .join(' · ')}
          </Text>
          <Text style={[styles.score, tint.text]}>{r.score.toFixed(2)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function SimChip({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const tint = useTint();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, on ? tint.chipOn : tint.chipOff, pressed && styles.pressed]} accessibilityRole="button" aria-pressed={on}>
      <Text style={[styles.chipText, on ? tint.onAccent : tint.text]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sim: { gap: 16, padding: 16, alignSelf: 'center' },
  note: { fontSize: 12.5 },
  h: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  catValue: { width: 36, textAlign: 'right', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  whyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pos: { width: 16, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  why: { flex: 1, fontSize: 12, lineHeight: 16 },
  score: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chip: { paddingHorizontal: 10, height: 30, borderRadius: 15, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

const useTint = themed((c) => ({
  text: { color: c.text },
  dim: { color: c.textDim },
  chipOn: { backgroundColor: c.accent },
  chipOff: { backgroundColor: c.surfaceRaised },
  onAccent: { color: c.onAccent },
}));
