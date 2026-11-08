import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { requestTab } from '@/ui/TabBar';
import { themed, usePalette } from '@/ui/theme';
import type { GameDesigns } from '../designs';
import { stageSize, useFrame } from '../frame';
import { NATIVE, lerp, useEased } from '../motion';
import { SKILL_CATEGORIES } from '@/skills/categories';
import { SkillBars } from '@/skills/SkillBars';
import { useScorableCategories } from '@/skills/useScorable';
import { ResolveText } from '../ResolveText';
import type { FinishedRound } from '../store';
import { Expand, type Rect } from './Expand';
import { ResultTile, type ResultEntry, type TileHandle } from './ResultTile';

/** Leaves the game for the feed, which stayed mounted underneath at the same clip. */
export function backToFeed() {
  requestTab('home');
  router.dismissTo('/');
}

/** Every clip the round showed, in order: each guess, then the clip on screen when time ran out. */
export function resultEntries(done: FinishedRound): ResultEntry[] {
  const out: ResultEntry[] = [];
  for (const g of done.round.guesses) {
    const clip = done.clips.get(g.clipId);
    if (clip) out.push({ clipId: g.clipId, clip, truth: g.truth, guess: g.guess, correct: g.correct });
  }
  const last = done.round.endReason === 'time' ? done.round.deck[done.round.index] : undefined;
  const clip = last && done.clips.get(last.id);
  if (last && clip) out.push({ clipId: last.id, clip, truth: last.truth });
  return out;
}

/** When each tile reveals, ms from the start: one value drives them all. */
export function revealSchedule(n: number, design: GameDesigns['reveal']) {
  const lead = 450;
  const stagger = Math.max(55, Math.min(140, 1800 / Math.max(1, n)));
  const span = design === 'flip' ? 560 : design === 'sweep' ? 480 : 620;
  const cueLag = 320;
  const start = (i: number) => lead + i * stagger;
  const total = start(Math.max(0, n - 1)) + span + cueLag;
  return { start, span, cueLag, total };
}

interface Props {
  done: FinishedRound;
  designs: GameDesigns;
  /** The lab hides the buttons that would leave it. */
  actions?: boolean;
}

/** After a round: the score counting up while every clip of the round reveals whether you got it right. */
export function Results({ done, designs, actions = true }: Props) {
  const { stats, newBest } = done;
  const frame = useFrame();
  const c = usePalette();
  const tint = useTint();
  const entries = useMemo(() => resultEntries(done), [done]);
  const { categories: scorable } = useScorableCategories();
  const skillsIn = useEased(done.skills ? 1 : 0, 420);
  const sched = useMemo(() => revealSchedule(entries.length, designs.reveal), [entries.length, designs.reveal]);

  // ---- the reveal: one linear clock (ms) for every tile ----
  const [r] = useState(() => new Animated.Value(0));
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    r.setValue(0);
    const a = Animated.timing(r, { toValue: sched.total, duration: sched.total, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start(({ finished }) => finished && setRevealed(true));
    return () => a.stop();
  }, [r, sched.total]);

  // Each tile's reveal and cue, cut from the one clock (built once, not per render).
  const curves = useMemo(
    () =>
      entries.map((_, i) => {
        const s = sched.start(i);
        return { t: lerp(r, [s, s + sched.span], [0, 1]), cue: lerp(r, [s + sched.span * 0.7, s + sched.span + sched.cueLag], [0, 1]) };
      }),
    [entries, r, sched],
  );

  // ---- layout ----
  const desktop = frame.desktop;
  const contentW = Math.min(frame.width, desktop ? 720 : frame.width) - 32;
  const columns = desktop ? 6 : entries.length <= 9 ? 3 : 4;
  const gap = 8;
  const tileW = Math.floor((contentW - gap * (columns - 1)) / columns);

  // ---- opening a clip ----
  const rootRef = useRef<TileHandle>(null);
  const tileRefs = useRef(new Map<number, TileHandle>());
  const [open, setOpen] = useState<{ i: number; from: Rect; closing: boolean } | null>(null);
  const stage = stageSize(frame);
  const to: Rect = { x: (frame.width - stage.width) / 2, y: stage.marginTop, w: stage.width, h: stage.height };
  const measureTile = useCallback((i: number, then: (r: Rect) => void) => {
    const tile = tileRefs.current.get(i);
    const root = rootRef.current;
    if (!tile || !root) return;
    root.measureInWindow((rx, ry) => tile.measureInWindow((x, y, w, h) => then({ x: x - rx, y: y - ry, w, h })));
  }, []);
  const openTile = (i: number) => measureTile(i, (from) => setOpen({ i, from, closing: false }));
  // Closing re-measures, in case the page scrolled underneath.
  const close = useCallback(() => {
    setOpen((o) => (o && !o.closing ? { ...o, closing: true } : o));
  }, []);
  useEffect(() => {
    if (!open?.closing) return;
    measureTile(open.i, (from) => setOpen((o) => (o ? { ...o, from } : o)));
    // Only when closing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.closing]);
  const onClosed = useCallback(() => setOpen(null), []);

  // A new best glows in once the score has landed.
  const glow = useMemo(() => lerp(r, [sched.total - sched.cueLag, sched.total], [0, 1]), [r, sched]);

  return (
    <View ref={rootRef} style={[styles.root, tint.root]} collapsable={false}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: (desktop ? 0 : frame.top) + 28 }]}>
        <View style={[styles.header, { width: contentW }]}>
          <CountUp
            value={stats.score}
            delay={sched.start(0)}
            duration={Math.max(600, sched.total - sched.start(0) - sched.cueLag)}
            style={[styles.score, tint.text]}
          />
          <View style={styles.bestWrap}>
            {newBest && <Animated.View style={[StyleSheet.absoluteFill, styles.glow, tint.glow, { opacity: glow }]} pointerEvents="none" />}
            <View style={[styles.best, tint.chip]}>
              <Ionicons name="trophy-outline" size={13} color={c.text} />
              <Text style={[styles.bestText, tint.text]}>{newBest ? `New best ${stats.score}` : `Best ${Math.max(stats.score, done.best)}`}</Text>
            </View>
          </View>
          <View style={[styles.stats, tint.card]}>
            <Stat label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} on={revealed} delay={0} />
            <Stat label="AI caught" value={`${stats.hits}/${stats.aiSeen}`} on={revealed} delay={60} />
            <Stat label="False alarms" value={String(stats.falseAlarms)} on={revealed} delay={120} />
          </View>
        </View>

        {/* Skills: how this round moved them, once recorded. */}
        <Animated.View style={[styles.skills, tint.card, { width: contentW, opacity: skillsIn, transform: [{ translateY: lerp(skillsIn, [0, 1], [10, 0]) }] }]}>
          {done.skills && (
            <SkillBars
              skills={done.skills.after}
              before={done.skills.before}
              categories={SKILL_CATEGORIES.filter((c) => done.skills!.touched.includes(c) || scorable.includes(c))}
              touched={done.skills.touched}
              delay={Math.max(0, sched.total - 600)}
            />
          )}
        </Animated.View>

        <View style={[styles.grid, { width: contentW, gap }]} accessibilityLabel={`${entries.length} clips`}>
          {entries.map((entry, i) => {
            return (
              <ResultTile
                key={`${entry.clipId}-${i}`}
                ref={(v) => {
                  if (v) tileRefs.current.set(i, v);
                  else tileRefs.current.delete(i);
                }}
                entry={entry}
                width={tileW}
                reveal={designs.reveal}
                grid={designs.grid}
                t={curves[i].t}
                cue={curves[i].cue}
                hidden={open?.i === i && designs.expand !== 'zoom'}
                onPress={() => openTile(i)}
              />
            );
          })}
        </View>

        {actions && (
          <View style={[styles.actions, { width: contentW }]}>
            <Pressable
              onPress={() => router.replace('/game')}
              style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, tint.primaryText]}>Play again</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/game/skills')} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.secondaryText, tint.dim]}>Your skills</Text>
            </Pressable>
            <Pressable onPress={backToFeed} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.secondaryText, tint.dim]}>Back to feed</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {open && (
        <Expand
          key={open.i}
          design={designs.expand}
          entry={entries[open.i]}
          from={open.from}
          to={to}
          toRadius={desktop ? 18 : 0}
          closing={open.closing}
          onClose={close}
          onClosed={onClosed}
          top={desktop ? 0 : frame.top}
          bottom={0}
        />
      )}
    </View>
  );
}

/** The score counting up continuously to `value`; it re-renders only itself as it counts. */
function CountUp({ value, delay, duration, style }: { value: number; delay: number; duration: number; style: object }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const v = new Animated.Value(0);
    const id = v.addListener(({ value: x }) => setShown(Math.round(x)));
    const a = Animated.timing(v, { toValue: value, delay, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start(({ finished }) => finished && setShown(value));
    return () => {
      a.stop();
      v.removeListener(id);
    };
  }, [value, delay, duration]);
  return (
    <Text style={style} accessibilityLabel={`Score ${value}`} testID="game-score">
      {shown}
    </Text>
  );
}

function Stat({ label, value, on, delay }: { label: string; value: string; on: boolean; delay: number }) {
  const tint = useTint();
  return (
    <View style={styles.stat}>
      <ResolveText on={on} delay={delay} style={[styles.statValue, tint.text]}>
        {value}
      </ResolveText>
      <Text style={[styles.statLabel, tint.dim]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { alignItems: 'center', gap: 22, paddingHorizontal: 16, paddingBottom: 28 },
  header: { alignItems: 'center', gap: 12 },
  score: { fontSize: 84, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 92 },
  bestWrap: { alignItems: 'center', justifyContent: 'center' },
  glow: { borderRadius: 20, margin: -8, ...(Platform.OS === 'web' ? { filter: 'blur(10px)' } : null) },
  best: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: 15 },
  bestText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', alignSelf: 'stretch', borderRadius: 16, paddingVertical: 14 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  skills: { borderRadius: 16, padding: 16, minHeight: 60 },
  actions: { gap: 4 },
  primary: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '700' },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  chip: { backgroundColor: c.surfaceRaised },
  glow: { backgroundColor: c.accentSoft },
  primary: { backgroundColor: c.accent },
  primaryText: { color: c.onAccent },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
