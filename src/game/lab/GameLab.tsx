import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from '../config';
import { GAME_DESIGNS, GAME_ELEMENTS, isDesign, stepDesign, type GameDesigns, type GameElement } from '../designs';
import { setGameDesign, useGameDesigns } from '../devOptions';
import { FrameContext, stageSize, useFrame, type FrameSize } from '../frame';
import { GameStage, type Stamp } from '../GameStage';
import { Countdown } from '../hud/Countdown';
import { Hud, hudAnchor, useTimeFraction } from '../hud/Hud';
import { useEased } from '../motion';
import { Pager, slideTo, type Point } from '../Pager';
import { loadPlayableClips } from '../playable';
import { Results } from '../results/Results';
import { createRound, remaining, roundReducer, type RoundState } from '../round';
import { fakeRound } from './fake';
import { BOTS, RankerSim, SimChip, SkillsSim, TASTES, WEAKNESS, type SkillSimParams } from './SimViews';

import type { SkillCategory } from '@/skills/categories';
import { freshSkills, recordAnswer } from '@/skills/skill';

/** The lab's tabs: one per element of the round, then the simulations. */
const LAB_VIEWS = [...GAME_ELEMENTS, 'skills', 'ranker'] as const;
type LabView = (typeof LAB_VIEWS)[number];
const SIM_LABELS = { skills: 'Skill bot', ranker: 'Feed ranker' } as const;
const isElement = (v: LabView): v is GameElement => (GAME_ELEMENTS as readonly string[]).includes(v);

/**
 * Dev builds: the timed round's designs, one element at a time, with fake
 * states so each can be tried without playing a round. Picks here are the
 * same as Dev settings → Game (and what the next real round uses in dev).
 * `?el=reveal&reveal=flip` opens on an element and design (for screenshots).
 */
export function GameLab() {
  const params = useLocalSearchParams<Record<string, string>>();
  const designs = useGameDesigns();
  const [el, setEl] = useState<LabView>(() => (LAB_VIEWS as readonly string[]).includes(params.el ?? '') ? (params.el as LabView) : 'countdown');
  const [sim, setSim] = useState<SkillSimParams>(() => ({
    bot: (params.bot as SkillSimParams['bot']) in BOTS ? (params.bot as SkillSimParams['bot']) : 'average',
    weak: (params.weak as SkillSimParams['weak']) in WEAKNESS ? (params.weak as SkillSimParams['weak']) : 'none',
    rounds: Number(params.rounds) > 0 ? Number(params.rounds) : 30,
    adaptive: params.adaptive !== '0',
    scale: Number(params.scale) > 1 ? Number(params.scale) : 1,
  }));
  const [taste, setTaste] = useState<keyof typeof TASTES>((params.taste as keyof typeof TASTES) in TASTES ? (params.taste as keyof typeof TASTES) : 'bodies');
  const [replay, setReplay] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Number(params.left) > 0 ? Number(params.left) * 1000 : 60_000);
  const [judged, setJudged] = useState(Number(params.n) > 0 ? Number(params.n) : 16);
  const [right, setRight] = useState(params.right ? Number(params.right) : 0.75);
  const [newBest, setNewBest] = useState(params.best === '1');
  const [clips, setClips] = useState<Clip[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const insets = useSafeAreaInsets();
  const c = usePalette();
  const tint = useTint();
  const wide = Platform.OS === 'web' && size.width + 340 >= 900;

  // Designs named in the URL apply once.
  useEffect(() => {
    const patch: Partial<Record<GameElement, string>> = {};
    for (const e of GAME_ELEMENTS) if (isDesign(e, params[e])) patch[e] = params[e];
    if (Object.keys(patch).length) setGameDesign(patch as Partial<GameDesigns>);
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    loadPlayableClips()
      .then((ok) => (ok.length ? ok : loadInitialClips()))
      .then((all) => live && setClips(all.filter((x) => !x.aspect || x.aspect < 1).concat(all.filter((x) => x.aspect && x.aspect >= 1))));
    return () => {
      live = false;
    };
  }, []);

  const pick = useCallback(
    (id: string) => {
      if (!isElement(el)) return;
      setGameDesign({ [el]: id } as Partial<GameDesigns>);
      setReplay((r) => r + 1);
    },
    [el],
  );

  // [ and ] step the design; 1–6 pick the element; R replays.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === '[' || e.key === ']') && isElement(el)) pick(stepDesign(el, designs[el], e.key === ']' ? 1 : -1));
      else if (/^[1-8]$/.test(e.key)) setEl(LAB_VIEWS[Number(e.key) - 1]);
      else if (e.key === 'r' || e.key === 'R') setReplay((r) => r + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [el, designs, pick]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  const frame: FrameSize = { width: size.width, height: size.height, desktop: wide, top: 0 };
  const info = isElement(el) ? GAME_DESIGNS[el] : null;
  const resultsEl = el === 'reveal' || el === 'grid' || el === 'expand';

  const controls = (
    <ScrollView style={[styles.panel, wide ? styles.panelWide : styles.panelNarrow, tint.panel]} contentContainerStyle={styles.panelBody} data-own-wheel="">
      <View style={styles.headRow}>
        <Text style={[styles.h1, tint.text]}>Game lab</Text>
        <Pressable onPress={() => router.push('/game')} style={({ pressed }) => [styles.link, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="play" size={14} color={c.link} />
          <Text style={[styles.linkText, { color: c.link }]}>Real round</Text>
        </Pressable>
      </View>

      <View style={styles.chips} role="tablist">
        {LAB_VIEWS.map((e, i) => (
          <Chip key={e} on={e === el} onPress={() => setEl(e)} label={`${i + 1} ${isElement(e) ? GAME_DESIGNS[e].label : SIM_LABELS[e]}`} testID={`lab-el-${e}`} />
        ))}
      </View>

      {el === 'skills' && (
        <>
          <Text style={[styles.h2, tint.dim]}>Bot</Text>
          <View style={styles.chips}>
            {(Object.keys(BOTS) as (keyof typeof BOTS)[]).map((b) => (
              <SimChip key={b} on={sim.bot === b} onPress={() => setSim((x) => ({ ...x, bot: b }))} label={BOTS[b].label} />
            ))}
          </View>
          <View style={styles.chips}>
            {(Object.keys(WEAKNESS) as (keyof typeof WEAKNESS)[]).map((w) => (
              <SimChip key={w} on={sim.weak === w} onPress={() => setSim((x) => ({ ...x, weak: w }))} label={WEAKNESS[w].label} />
            ))}
          </View>
          <Text style={[styles.h2, tint.dim]}>Rounds · dealing · catalog</Text>
          <View style={styles.chips}>
            {[10, 30, 60].map((n) => (
              <SimChip key={n} on={sim.rounds === n} onPress={() => setSim((x) => ({ ...x, rounds: n }))} label={`${n} rounds`} />
            ))}
          </View>
          <View style={styles.chips}>
            <SimChip on={sim.adaptive} onPress={() => setSim((x) => ({ ...x, adaptive: true }))} label="Adaptive" />
            <SimChip on={!sim.adaptive} onPress={() => setSim((x) => ({ ...x, adaptive: false }))} label="Shuffle" />
          </View>
          <View style={styles.chips}>
            <SimChip on={sim.scale === 1} onPress={() => setSim((x) => ({ ...x, scale: 1 }))} label="Today’s clips" />
            <SimChip on={sim.scale === 5} onPress={() => setSim((x) => ({ ...x, scale: 5 }))} label="5× catalog" />
          </View>
        </>
      )}
      {el === 'ranker' && (
        <>
          <Text style={[styles.h2, tint.dim]}>Viewer</Text>
          <View style={styles.chips}>
            {(Object.keys(TASTES) as (keyof typeof TASTES)[]).map((t) => (
              <SimChip key={t} on={taste === t} onPress={() => setTaste(t)} label={TASTES[t].label} />
            ))}
          </View>
        </>
      )}

      {info && <Text style={[styles.h2, tint.dim]}>{info.label} · design</Text>}
      {info && <View style={styles.options}>
        {info.options.map((o) => {
          const on = isElement(el) && designs[el] === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => pick(o.id)}
              style={({ pressed }) => [styles.option, tint.option, on && tint.optionOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              aria-checked={on}
              testID={`lab-design-${o.id}`}
            >
              <View style={styles.optionHead}>
                <Text style={[styles.optionTitle, tint.text]}>{o.label}</Text>
                {o.id === info.default && <Ionicons name="star" size={12} color={c.textDim} accessibilityLabel="Recommended" />}
              </View>
              <Text style={[styles.optionNote, tint.dim]}>{o.note}</Text>
            </Pressable>
          );
        })}
      </View>}
      {info && <Text style={[styles.why, tint.dim]}>★ {info.why}</Text>}

      {info && <Text style={[styles.h2, tint.dim]}>Fake state</Text>}
      {(el === 'countdown' || el === 'hud') && (
        <View style={styles.chips}>
          {[60, 30, 10, 3].map((s) => (
            <Chip key={s} on={timeLeft === s * 1000} onPress={() => (setTimeLeft(s * 1000), setReplay((r) => r + 1))} label={`${s} s left`} />
          ))}
        </View>
      )}
      {resultsEl && (
        <>
          <View style={styles.chips}>
            {[6, 16, 30].map((n) => (
              <Chip key={n} on={judged === n} onPress={() => (setJudged(n), setReplay((r) => r + 1))} label={`${n} clips`} />
            ))}
          </View>
          <View style={styles.chips}>
            {[1, 0.75, 0.5, 0.25].map((x) => (
              <Chip key={x} on={right === x} onPress={() => (setRight(x), setReplay((r) => r + 1))} label={`${x * 100}% right`} />
            ))}
          </View>
          <View style={styles.chips}>
            <Chip on={newBest} onPress={() => (setNewBest((b) => !b), setReplay((r) => r + 1))} label="New best" />
          </View>
        </>
      )}
      {el === 'transition' && <Text style={[styles.optionNote, tint.dim]}>Double tap (or A) marks AI; swipe up (wheel, J) skips. The buttons below the clip do the same.</Text>}

      <Pressable onPress={() => setReplay((r) => r + 1)} style={({ pressed }) => [styles.replay, tint.primary, pressed && styles.pressed]} accessibilityRole="button" testID="lab-replay">
        <Ionicons name="refresh" size={16} color={c.onAccent} />
        <Text style={[styles.replayText, { color: c.onAccent }]}>Replay</Text>
      </Pressable>
      <Text style={[styles.keys, tint.dim]}>Keys: 1–8 tab · [ ] design · R replay</Text>
    </ScrollView>
  );

  return (
    <View style={[styles.root, tint.root, wide ? styles.row : styles.column, { paddingTop: wide ? 0 : insets.top }]}>
      {wide && controls}
      <View style={styles.preview} onLayout={onLayout} testID="lab-preview">
        {size.width > 0 && clips.length > 0 && (
          <FrameContext.Provider value={frame}>
            {(el === 'countdown' || el === 'hud') && <HudPreview key={`hud-${replay}`} designs={designs} timeLeftMs={timeLeft} poster={clips[0]} />}
            {el === 'transition' && <TransitionPreview key={`tr-${replay}-${designs.transition}`} designs={designs} clips={clips} />}
            {resultsEl && <ResultsPreview key={`res-${replay}-${designs.reveal}-${designs.grid}`} designs={designs} clips={clips} judged={judged} right={right} newBest={newBest} />}
            {el === 'skills' && <SkillsSim key={`sk-${replay}`} clips={clips} params={sim} width={Math.min(size.width - 16, 640)} />}
            {el === 'ranker' && <RankerSim key={`rk-${replay}`} clips={clips} taste={taste} sessions={12} width={Math.min(size.width - 16, 640)} />}
          </FrameContext.Provider>
        )}
      </View>
      {!wide && controls}
    </View>
  );
}

/** Countdown → timer: a countdown that lands in the timer, which then runs from the time left. Pause runs it back out. */
function HudPreview({ designs, timeLeftMs, poster }: { designs: GameDesigns; timeLeftMs: number; poster: Clip }) {
  const frame = useFrame();
  const { width, height, marginTop } = stageSize(frame);
  const [s, dispatch] = useReducer(roundReducer, null, (): RoundState => ({ ...createRound([{ id: 'x', truth: 'ai' }], GAME.roundMs), remainingMs: timeLeftMs }));
  const [clock, setClock] = useState(0);
  useEffect(() => {
    dispatch({ type: 'START', now: performance.now() });
    const t = setInterval(() => {
      const n = performance.now();
      dispatch({ type: 'TICK', now: n });
      setClock(n);
    }, 100);
    return () => clearInterval(t);
  }, []);
  const [cdEnd, setCdEnd] = useState<number | null>(null);
  if (s.countdownEnd !== null && s.countdownEnd !== cdEnd) setCdEnd(s.countdownEnd);
  const hudOn = s.phase === 'playing' || s.phase === 'paused' || s.phase === 'over';
  const morph = useEased(hudOn ? 1 : 0, 560);
  const shown = useEased(1);
  const frac = useTimeFraction(s.remainingMs, s.phase === 'playing' ? s.deadline : null, s.durationMs);
  const tint = useTint();
  const paused = s.phase === 'paused';
  return (
    <View style={styles.center}>
      <View style={[styles.stage, { width, height, marginTop }]}>
        <Image source={poster.poster} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <Hud
          design={designs.hud}
          frac={frac}
          durationMs={s.durationMs}
          displayMs={Math.min(s.remainingMs, remaining(s, clock))}
          judged={7}
          width={width}
          top={0}
          appear={morph}
        />
        <Countdown design={designs.countdown} endAt={cdEnd} totalMs={GAME.countdownMs} width={width} height={height} anchor={hudAnchor(designs.hud, width, 0)} morph={morph} shown={shown} />
        <View style={styles.stageButtons}>
          <Pressable
            onPress={() => dispatch({ type: paused ? 'RESUME' : 'PAUSE', now: performance.now() })}
            style={({ pressed }) => [styles.smallButton, tint.option, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={[styles.smallButtonText, tint.text]}>{paused ? 'Resume (morphs back out)' : 'Pause'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Clip change: the real stage and pager over the lab's clips, looping. */
function TransitionPreview({ designs, clips }: { designs: GameDesigns; clips: Clip[] }) {
  const frame = useFrame();
  const { width, height, marginTop } = stageSize(frame);
  const deck = useMemo(() => Array.from({ length: 200 }, (_, i) => ({ ...clips[i % clips.length], id: `t-${i}` })), [clips]);
  const [shown, setShown] = useState(0);
  const [pos] = useState(() => new Animated.Value(0));
  const [dir] = useState(() => new Animated.Value(0));
  const [busy, setBusy] = useState(false);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const tint = useTint();
  const moveOn = useCallback(
    (from: number, velocity = 0) => {
      const next = from + 1;
      setShown(next);
      slideTo(pos, next, velocity, () => {
        setBusy(false);
        dir.setValue(0);
        setStamps((st) => st.filter((x) => x.idx >= next - 1));
      });
    },
    [pos, dir],
  );
  const mark = useCallback(
    (at: Point) => {
      if (busy) return;
      setBusy(true);
      setStamps((st) => [...st, { key: shown, idx: shown, x: at.x, y: at.y }]);
      dir.setValue(1);
      setTimeout(() => moveOn(shown), GAME.markAdvanceMs);
    },
    [busy, shown, moveOn, dir],
  );
  const skip = useCallback(
    (velocity: number) => {
      if (busy) return false;
      setBusy(true);
      moveOn(shown, velocity);
      return true;
    },
    [busy, shown, moveOn],
  );
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A') mark({ x: width / 2, y: height / 2 });
      else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') skip(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mark, skip, width, height]);
  return (
    <View style={styles.center}>
      <View style={[styles.stage, { width, height, marginTop }]}>
        <GameStage clips={deck} index={shown} pos={pos} dir={dir} design={designs.transition} stamps={stamps} width={width} height={height} live muted />
        <Pager index={shown} pos={pos} height={height} enabled={!busy} onDoubleTap={mark} onSwipe={skip} />
        <View style={[styles.stageButtons, styles.stageButtonsRow]}>
          <Pressable onPress={() => mark({ x: width / 2, y: height / 2 })} style={({ pressed }) => [styles.smallButton, tint.option, pressed && styles.pressed]} accessibilityRole="button" testID="lab-mark">
            <Text style={[styles.smallButtonText, tint.text]}>Mark AI</Text>
          </Pressable>
          <Pressable onPress={() => skip(0)} style={({ pressed }) => [styles.smallButton, tint.option, pressed && styles.pressed]} accessibilityRole="button" testID="lab-skip">
            <Text style={[styles.smallButtonText, tint.text]}>Skip</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Results: a fake finished round with the asked shares, revealed in the chosen designs. */
function ResultsPreview({ designs, clips, judged, right, newBest }: { designs: GameDesigns; clips: Clip[]; judged: number; right: number; newBest: boolean }) {
  const done = useMemo(() => {
    const f = fakeRound(clips, { judged, right, ai: 0.5, timeUp: true, seed: judged * 7 + Math.round(right * 100) });
    // How the round would move a newcomer's skills (categories by turns, as a stand-in for real tells).
    const order: SkillCategory[] = ['subject', 'text', 'visuals', 'other'];
    const before = freshSkills();
    let after = before;
    const touched = new Set<SkillCategory>();
    f.round.guesses.forEach((g, i) => {
      const cat: SkillCategory = g.truth === 'real' ? 'real' : order[i % order.length];
      touched.add(cat);
      after = recordAnswer(after, { [cat]: 1 }, 0, g.correct);
    });
    return { ...f, newBest, best: newBest ? f.stats.score : f.stats.score + 4, skills: { before, after, touched: [...touched] } };
  }, [clips, judged, right, newBest]);
  return <Results done={done} designs={designs} actions={false} />;
}

function Chip({ on, onPress, label, testID }: { on: boolean; onPress: () => void; label: string; testID?: string }) {
  const tint = useTint();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, tint.option, on && tint.chipOn, pressed && styles.pressed]} accessibilityRole="button" aria-pressed={on} testID={testID}>
      <Text style={[styles.chipText, on ? tint.onAccentText : tint.text]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  panel: { flexGrow: 0 },
  panelWide: { width: 340, height: '100%' },
  panelNarrow: { maxHeight: 300 },
  panelBody: { padding: 16, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { fontSize: 20, fontWeight: '800' },
  h2: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  linkText: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, height: 30, borderRadius: 15, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  options: { gap: 6 },
  option: { borderRadius: 12, padding: 10, gap: 3, borderWidth: 1, borderColor: 'transparent' },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optionTitle: { fontSize: 15, fontWeight: '700' },
  optionNote: { fontSize: 12.5, lineHeight: 17 },
  why: { fontSize: 12.5, lineHeight: 17, fontStyle: 'italic' },
  replay: { marginTop: 8, height: 40, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  replayText: { fontSize: 15, fontWeight: '700' },
  keys: { fontSize: 12 },
  preview: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center' },
  stage: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#000' },
  stageButtons: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  stageButtonsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  smallButton: { paddingHorizontal: 14, height: 36, borderRadius: 18, justifyContent: 'center' },
  smallButtonText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  panel: { backgroundColor: c.surface },
  option: { backgroundColor: c.surfaceRaised },
  optionOn: { borderColor: c.accent },
  chipOn: { backgroundColor: c.accent },
  onAccentText: { color: c.onAccent },
  primary: { backgroundColor: c.accent },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
