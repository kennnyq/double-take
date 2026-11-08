import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, AppState, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Clip } from '@/data/clips';
import { signals } from '@/engagement/store';
import type { FeedMode, StageRect } from '@/feed/mode';
import type { SkillCategory } from '@/skills/categories';
import { clipMeta, loadMetas } from '@/skills/loadMeta';
import { difficultyOf } from '@/skills/state';
import { skillStore } from '@/skills/store';
import { themed, usePalette } from '@/ui/theme';
import { buildAdaptiveDeck } from './adaptive';
import { GAME } from './config';
import { buildDeck, clipKey } from './deck';
import { gameDev, useGameDev } from './devOptions';
import { useFrame } from './frame';
import { recentClipKeys } from './history';
import { Countdown } from './hud/Countdown';
import { Hud, ROW_H, ROW_Y, hudAnchor, useTimeFraction } from './hud/Hud';
import { safeClip } from './leaks';
import { MarkStamp } from './MarkStamp';
import { lerp, useEased } from './motion';
import { loadPlayableClips } from './playable';
import { ResolveText } from './ResolveText';
import { createRound, remaining, roundReducer, type Phase, type RoundState } from './round';
import { RoundFeed, type RoundFeedHandle } from './RoundFeed';
import { roundStats, scoreRound } from './score';
import { getFinishedRound, gameHistory, setFinishedRound } from './store';

const now = () => performance.now();
/** How often the clock checks the deadline and refreshes the readout. */
const TICK_MS = 100;
/** After time is up, the veil shows this long before the results. */
const END_HOLD_MS = 1300;
/** The countdown flying into the timer (and back out on a resume). */
const MORPH_MS = 560;

type Dealt = { clip: Clip; truth: 'ai' | 'real' };
type Point = { x: number; y: number };
type Designs = ReturnType<typeof useGameDev>['designs'];

/** The untimed game deals this many clips at a time, and deals more once this few are left. */
const BATCH = 20;
const DEAL_AHEAD = 5;

/**
 * Deals clips whose media loads: near the player's skill when adaptive dealing
 * is on (Dev settings), else an even shuffle; clips in `avoid` (the last rounds,
 * or this game so far) come last.
 */
async function deal(avoid: Iterable<string>, cap?: number): Promise<Dealt[]> {
  const clips = await loadPlayableClips();
  const recent = [...recentClipKeys(gameHistory.getSnapshot()), ...avoid];
  if (gameDev.getSnapshot().adaptive) {
    // Near the player's skill: each clip's categories and difficulty first.
    const metas = await loadMetas(clips);
    const state = skillStore.getSnapshot();
    const sources = clips.map((cl) => {
      const m = metas.get(clipKey(cl))!;
      return { ...cl, cats: m.cats, difficulty: difficultyOf(state, clipKey(cl), m.prior) };
    });
    return buildAdaptiveDeck(sources, { skills: state.skills, recent, cap });
  }
  const dealt = buildDeck(clips, { recent, cap });
  // Warm the metadata the answers will need.
  loadMetas(dealt.map((d) => d.clip));
  return dealt;
}

/**
 * A game in the feed: the timed round (60 s, the demo, from Dev settings) or,
 * with `timed={false}`, the untimed game of the Game tab: no countdown and no
 * clock, clip after clip, every answer going to Your skills.
 */
export function GameRound({ timed = true }: { timed?: boolean }) {
  const [deck, setDeck] = useState<Dealt[] | null>(null);
  const dev = useGameDev();
  const c = usePalette();
  useEffect(() => {
    let live = true;
    void deal([], timed ? undefined : BATCH).then((d) => live && setDeck(timed ? d : relabel(d, 0)));
    return () => {
      live = false;
    };
  }, [timed]);
  if (!deck) return <View style={[styles.root, { backgroundColor: c.bg }]} />;
  return <Round deck={deck} timed={timed} durationMs={dev.roundMs} showTruth={dev.showTruth} designs={dev.designs} />;
}

/** The untimed game can deal a clip again later: each deal's clips get ids of their own (the feed keys its pages by id). */
function relabel(d: Dealt[], batch: number): Dealt[] {
  return d.map((x) => ({ ...x, clip: { ...x.clip, id: `${x.clip.id}~${batch}` } }));
}

/** What the overlay over the feed draws from: the round, and what it can do. */
interface RoundUi {
  s: RoundState;
  clock: number;
  shown: number;
  designs: Designs;
  showTruth: boolean;
  truth: 'ai' | 'real' | undefined;
  poster: Clip['poster'] | undefined;
  stamp: { key: number; x: number; y: number; leaving: boolean } | null;
  quitAsked: boolean;
  start: () => void;
  resume: () => void;
  askQuit: () => void;
  quit: () => void;
  /** The untimed game's last answer, for its brief ✓ / ✕ (keyed so each one plays). */
  last: { key: number; correct: boolean } | null;
}
const RoundContext = createContext<RoundUi | null>(null);

/**
 * One round, run as a mode of the app's own feed (see `src/feed/mode.ts`):
 * the feed shows the deck through `safeClip` (nothing that gives an answer
 * away), with the clips' controls locked; a double tap marks the clip AI and
 * moving past the clip being judged skips it. This component only keeps the
 * round's state and draws the overlay: the clock, the countdown, the veil and
 * the round's buttons.
 */
function Round({ deck, timed, durationMs, showTruth, designs }: { deck: Dealt[]; timed: boolean; durationMs: number; showTruth: boolean; designs: Designs }) {
  // The untimed game's deck grows as it's dealt.
  const [dealt, setDealt] = useState(deck);
  const clips = useMemo(() => dealt.map((d) => d.clip), [dealt]);
  const [s, dispatch] = useReducer(roundReducer, null, () =>
    createRound(
      deck.map((d) => ({ id: d.clip.id, truth: d.truth })),
      durationMs,
      timed,
    ),
  );
  const tint = useTint();

  // ---- the untimed game: no countdown, more clips as it goes, every answer to Your skills ----
  useEffect(() => {
    if (!timed) dispatch({ type: 'START', now: now() });
  }, [timed]);
  const dealing = useRef(false);
  const batches = useRef(1);
  useEffect(() => {
    if (timed || dealing.current || s.index < dealt.length - DEAL_AHEAD) return;
    dealing.current = true;
    void deal(dealt.map((d) => clipKey(d.clip)), BATCH).then((more) => {
      const next = relabel(more, batches.current++);
      dealing.current = false;
      if (!next.length) return;
      setDealt((d) => [...d, ...next]);
      dispatch({ type: 'DEAL', cards: next.map((d) => ({ id: d.clip.id, truth: d.truth })) });
    });
  }, [timed, s.index, dealt]);
  const recorded = useRef(0);
  const [last, setLast] = useState<RoundUi['last']>(null);
  useEffect(() => {
    if (timed || s.guesses.length <= recorded.current) return;
    const fresh = s.guesses.slice(recorded.current);
    recorded.current = s.guesses.length;
    const g = fresh[fresh.length - 1];
    setLast({ key: s.guesses.length, correct: g.correct });
    const byId = new Map(dealt.map((d) => [d.clip.id, d.clip]));
    const answered = fresh.map((x) => ({ g: x, clip: byId.get(x.clipId)! })).filter((x) => x.clip);
    for (const { g: x, clip } of answered) signals.note(clipKey(clip), { kind: 'answer', correct: x.correct });
    void Promise.all(answered.map(({ clip }) => clipMeta(clip))).then((metas) =>
      skillStore.recordRound(
        answered.map(({ g: x, clip }, i) => ({ key: clipKey(clip), correct: x.correct, cats: metas[i].cats, prior: metas[i].prior })),
        false,
      ),
    );
  }, [timed, s.guesses, dealt]);

  // ---- the clock ---------------------------------------------------------------
  const [clock, setClock] = useState(0);
  const ticking = s.phase === 'countdown' || s.phase === 'playing';
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => {
      const n = now();
      dispatch({ type: 'TICK', now: n });
      setClock(n);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [ticking]);

  // Backgrounded, or the tab hidden (AppState follows visibilitychange on web): freeze.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') dispatch({ type: 'PAUSE', now: now() });
    });
    return () => sub.remove();
  }, []);

  // ---- the feed's events ----------------------------------------------------------
  // `shown`: the clip the feed rests on. The round's own index moves at once on a
  // decision; `shown` follows when the feed comes to rest on the next clip.
  // Moving on from the clip being judged skips it; looking back is fine, but a
  // clip already judged can't be judged again.
  const [shown, setShown] = useState(0);
  const feed = useRef<RoundFeedHandle>(null);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState<RoundUi['stamp']>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  const playing = s.phase === 'playing';
  const canAct = playing && !busy && s.index === shown;

  const onActive = (i: number) => {
    if (i > shown && shown === s.index && playing && !busy) dispatch({ type: 'SKIP', now: now(), index: shown });
    setShown(i);
    setBusy(false);
    setStamp(null);
  };
  const markAI = (at: Point) => {
    if (!canAct) return;
    dispatch({ type: 'MARK_AI', now: now(), index: shown });
    setBusy(true);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setStamp({ key: shown, x: at.x, y: at.y, leaving: false });
    const next = shown + 1;
    advanceTimer.current = setTimeout(() => {
      if (next >= clips.length) return setBusy(false);
      setStamp((st) => (st ? { ...st, leaving: true } : st));
      feed.current?.goTo(next);
    }, GAME.markAdvanceMs);
  };
  const onDoubleTap = (i: number, at: Point, stage: StageRect | null) => {
    if (i !== shown) return;
    // Browsers can leave a tap's position unset: the stamp goes to the middle then.
    const ok = Number.isFinite(at.x) && Number.isFinite(at.y);
    markAI(ok ? at : { x: (stage?.w ?? 0) / 2, y: (stage?.h ?? 0) / 2 });
  };
  // The mode stays the same object across the clock's ticks; its callbacks reach the latest round through refs.
  const events = useRef({ onActive, onDoubleTap, markAI });
  useEffect(() => {
    events.current = { onActive, onDoubleTap, markAI };
  });
  const lastStage = useRef<StageRect | null>(null);
  const scrollEnabled = playing && !busy;
  const mode = useMemo<FeedMode>(
    () => ({
      clips,
      present: safeClip,
      onDoubleTap: (i, at) => events.current.onDoubleTap(i, at, lastStage.current),
      noHold: true,
      noTapPause: true,
      lockControls: true,
      keys: false,
      scrollEnabled,
      onActive: (i) => events.current.onActive(i),
      overlay: (stage) => {
        lastStage.current = stage;
        return <RoundOverlay stage={stage} />;
      },
    }),
    [clips, scrollEnabled],
  );

  // ---- pausing and quitting -----------------------------------------------------
  const [quitAsked, setQuitAsked] = useState(false);
  const start = useCallback(() => dispatch({ type: 'START', now: now() }), []);
  const resume = useCallback(() => {
    setQuitAsked(false);
    dispatch({ type: 'RESUME', now: now() });
  }, []);
  const askQuit = useCallback(() => {
    setQuitAsked(true);
    dispatch({ type: 'PAUSE', now: now() });
  }, []);
  const quit = useCallback(() => {
    dispatch({ type: 'QUIT', now: now() });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  // ---- the round's keys (browsers): the feed's own (↓/J, ↑/K, wheel) move it ----
  const phaseRef = useRef<Phase>(s.phase);
  useEffect(() => {
    phaseRef.current = s.phase;
  }, [s.phase]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (!s.timed) return;
        e.preventDefault();
        if (quitAsked || phaseRef.current === 'ready') quit();
        else askQuit();
      } else if (e.key === ' ') {
        // Nothing: a stray Space must not count as a guess.
        e.preventDefault();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const st = lastStage.current;
        events.current.markAI({ x: (st?.w ?? 0) / 2, y: (st?.h ?? 0) / 2 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askQuit, quit, quitAsked, s.timed]);

  // ---- the end ---------------------------------------------------------------------
  const ended = useRef(false);
  useEffect(() => {
    if (s.phase !== 'over' || ended.current) return;
    ended.current = true;
    if (s.endReason === 'quit') return;
    const stats = roundStats(s.guesses);
    const { newBest } = gameHistory.record(
      {
        endedAt: Date.now(),
        score: stats.score,
        judged: stats.judged,
        accuracy: stats.accuracy,
        hits: stats.hits,
        aiSeen: stats.aiSeen,
        falseAlarms: stats.falseAlarms,
        durationMs: s.durationMs,
      },
      clips.map(clipKey),
    );
    const byId = new Map(clips.map((cl) => [cl.id, cl]));
    const finished = { round: s, stats, newBest, best: gameHistory.getSnapshot().best, clips: byId };
    setFinishedRound(finished);
    // Skills: each answer, with its clip's categories and difficulty; the results show the change once it's in.
    const answered = s.guesses.map((g) => ({ g, clip: byId.get(g.clipId)! })).filter((x) => x.clip);
    for (const { g, clip } of answered) signals.note(clipKey(clip), { kind: 'answer', correct: g.correct });
    Promise.all(answered.map(({ clip }) => clipMeta(clip))).then((metas) => {
      const change = skillStore.recordRound(
        answered.map(({ g, clip }, i) => ({ key: clipKey(clip), correct: g.correct, cats: metas[i].cats, prior: metas[i].prior })),
      );
      const touched = [...new Set(metas.flatMap((m) => Object.keys(m.cats)))] as SkillCategory[];
      if (getFinishedRound()?.round === s) setFinishedRound({ ...finished, skills: { ...change, touched } });
    });
  }, [s, clips]);
  const toResults = s.phase === 'over' && s.endReason !== 'quit';
  useEffect(() => {
    if (!toResults) return;
    const t = setTimeout(() => router.replace('/game/results'), END_HOLD_MS);
    return () => clearTimeout(t);
  }, [toResults]);

  // Dev (web): the round's state for the browser checks.
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web') return;
    (window as unknown as { __dtGame?: unknown }).__dtGame = {
      phase: s.phase,
      index: s.index,
      shown,
      busy,
      remainingMs: s.remainingMs,
      deadline: s.deadline,
      guesses: s.guesses,
      deck: s.deck,
      endReason: s.endReason,
      timed: s.timed,
      designs,
    };
  }, [s, shown, busy, designs]);

  const ui: RoundUi = {
    s,
    clock,
    shown,
    designs,
    showTruth,
    truth: deck[shown]?.truth,
    poster: clips[shown]?.poster,
    stamp,
    quitAsked,
    start,
    resume,
    askQuit,
    quit,
    last,
  };
  return (
    <View style={[styles.root, tint.root]}>
      <RoundContext.Provider value={ui}>
        <RoundFeed mode={mode} live={playing} ref={feed} />
      </RoundContext.Provider>
    </View>
  );
}

/** Over the feed, on the active clip's stage: the timed round's or the untimed game's. */
function RoundOverlay({ stage }: { stage: StageRect }) {
  const ui = useContext(RoundContext)!;
  const frame = useFrame();
  // Under the status bar when the stage starts at the top of a phone screen.
  const top = !frame.desktop && stage.y === 0 ? frame.top : 0;
  return ui.s.timed ? <TimedOverlay stage={stage} top={top} /> : <UntimedOverlay stage={stage} top={top} />;
}

/** The timed round's overlay: the veil, the clock, the countdown and the round's buttons. */
function TimedOverlay({ stage, top }: { stage: StageRect; top: number }) {
  const ui = useContext(RoundContext)!;
  const { s, designs } = ui;
  const frame = useFrame();
  const tint = useTint();
  const c = usePalette();

  // The countdown holds its last end time while it flies into the timer.
  const [cdEnd, setCdEnd] = useState<number | null>(null);
  if (s.countdownEnd !== null && s.countdownEnd !== cdEnd) setCdEnd(s.countdownEnd);
  const hudOn = s.phase === 'playing' || s.phase === 'paused' || s.phase === 'over';
  const morph = useEased(hudOn ? 1 : 0, MORPH_MS);
  const countdownShown = useEased(s.phase === 'ready' ? 0 : 1);
  const veil = useEased(s.phase === 'playing' ? 0 : 1);
  const readyCard = useEased(s.phase === 'ready' ? 1 : 0);
  const pausedCard = useEased(s.phase === 'paused' ? 1 : 0);
  const frac = useTimeFraction(s.remainingMs, s.phase === 'playing' ? s.deadline : null, s.durationMs);
  // The readout follows the clock's ticks; the timer's fill runs on its own from the deadline.
  const displayMs = Math.min(s.remainingMs, remaining(s, ui.clock));

  return (
    <View
      style={[styles.stage, { left: stage.x, top: stage.y, width: stage.w, height: stage.h }, (frame.desktop || stage.y > 0) && styles.stageCard]}
      pointerEvents="box-none"
      testID="round-overlay"
    >
      {/* The veil: dims and blurs the waiting clip; fades out at Go. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]} pointerEvents={s.phase === 'playing' ? 'none' : 'auto'}>
        {ui.poster && <Image source={ui.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} />}
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
      </Animated.View>

      {ui.stamp && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <MarkStamp key={ui.stamp.key} x={ui.stamp.x} y={ui.stamp.y} leaving={ui.stamp.leaving} />
        </View>
      )}

      {/* The timer grows out of where the countdown lands. */}
      <Hud design={designs.hud} frac={frac} durationMs={s.durationMs} displayMs={displayMs} judged={s.guesses.length} width={stage.w} top={top} appear={morph} />
      <Countdown
        design={designs.countdown}
        endAt={cdEnd}
        totalMs={GAME.countdownMs}
        width={stage.w}
        height={stage.h}
        anchor={hudAnchor(designs.hud, stage.w, top)}
        morph={morph}
        shown={countdownShown}
      />

      {/* Quit (sound is the feed's own button). */}
      <View style={[styles.buttons, { top: top + ROW_Y }]} pointerEvents="box-none">
        <IconButton icon="close" label="Quit round" onPress={s.phase === 'ready' ? ui.quit : ui.askQuit} />
      </View>

      {/* Ready: how to play, and Start. */}
      <Fade value={readyCard} on={s.phase === 'ready'}>
        <View style={[styles.card, tint.card]}>
          <Hint icon="hand-left-outline" text={frame.desktop ? 'Double-click or A: AI' : 'Double tap: AI'} />
          <Hint icon="arrow-up-outline" text={frame.desktop ? 'Scroll or ↓: skip, counts as real' : 'Swipe up: skip, counts as real'} />
          <Pressable onPress={ui.start} style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={[styles.primaryText, tint.primaryText]}>Start</Text>
          </Pressable>
        </View>
      </Fade>

      {/* Paused (the app went to the background, or ✕). */}
      <Fade value={pausedCard} on={s.phase === 'paused'}>
        <View style={[styles.card, tint.card]}>
          <Text style={[styles.title, tint.text]}>{ui.quitAsked ? 'Quit round?' : 'Paused'}</Text>
          <Pressable onPress={ui.resume} style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={[styles.primaryText, tint.primaryText]}>Resume</Text>
          </Pressable>
          <Pressable onPress={ui.quit} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={[styles.secondaryText, tint.dim]}>Quit</Text>
          </Pressable>
        </View>
      </Fade>

      {/* Time's up: resolves like the double take's text. */}
      <View style={styles.center} pointerEvents="none">
        <ResolveText on={s.phase === 'over' && s.endReason !== 'quit'} style={[styles.big, tint.text]}>
          {s.endReason === 'deck' ? 'Done' : 'Time'}
        </ResolveText>
      </View>

      {__DEV__ && ui.showTruth && ui.truth && (
        <View style={[styles.truth, { top: top + ROW_Y + ROW_H + 8 }]} pointerEvents="none">
          <Text style={[styles.truthText, { color: c.textDim }]}>dev: {ui.truth}</Text>
        </View>
      )}
    </View>
  );
}

/** The untimed game's overlay: the stamp, and the score with a brief ✓ / ✕ after each answer. */
function UntimedOverlay({ stage, top }: { stage: StageRect; top: number }) {
  const ui = useContext(RoundContext)!;
  const frame = useFrame();
  const tint = useTint();
  const c = usePalette();
  const score = scoreRound(ui.s.guesses);
  // The ✓ / ✕ eases in after an answer and away again.
  const [showing, setShowing] = useState<RoundUi['last']>(null);
  const [off, setOff] = useState<number | null>(null);
  if (ui.last && ui.last.key !== showing?.key) setShowing(ui.last);
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => setOff(showing.key), RESULT_MS);
    return () => clearTimeout(t);
  }, [showing]);
  const result = useEased(showing && off !== showing.key ? 1 : 0, 240);
  return (
    <View
      style={[styles.stage, { left: stage.x, top: stage.y, width: stage.w, height: stage.h }, (frame.desktop || stage.y > 0) && styles.stageCard]}
      pointerEvents="box-none"
      testID="round-overlay"
    >
      {ui.stamp && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <MarkStamp key={ui.stamp.key} x={ui.stamp.x} y={ui.stamp.y} leaving={ui.stamp.leaving} />
        </View>
      )}
      <View style={[styles.scoreRow, { top: top + ROW_Y }]} pointerEvents="none">
        <View style={[styles.scorePill, tint.pill]} accessibilityLabel={`Score ${score}, ${ui.s.guesses.length} judged`} testID="game-score-live">
          <Text style={[styles.scoreText, tint.text]}>{score}</Text>
          <View style={styles.judged}>
            <Ionicons name="layers-outline" size={13} color={c.textDim} />
            <Text style={[styles.judgedText, tint.dim]}>{ui.s.guesses.length}</Text>
          </View>
          <Animated.View
            style={[
              styles.result,
              { backgroundColor: showing?.correct ? c.correct : c.incorrect, opacity: result, transform: [{ scale: lerp(result, [0, 1], [0.6, 1]) }] },
            ]}
            accessibilityLabel={showing ? (showing.correct ? 'Right' : 'Wrong') : undefined}
          >
            <Ionicons name={showing?.correct ? 'checkmark' : 'close'} size={14} color={c.onAccent} />
          </Animated.View>
        </View>
      </View>
      {__DEV__ && ui.showTruth && ui.truth && (
        <View style={[styles.truth, { top: top + ROW_Y + ROW_H + 8 }]} pointerEvents="none">
          <Text style={[styles.truthText, { color: c.textDim }]}>dev: {ui.truth}</Text>
        </View>
      )}
    </View>
  );
}

/** How long the untimed game's ✓ / ✕ stays after an answer. */
const RESULT_MS = 900;

/** A centred layer that eases in and out with `value`; it takes touches only while `on`. */
function Fade({ value, on, children }: { value: Animated.Value; on: boolean; children: React.ReactNode }) {
  return (
    <Animated.View
      style={[styles.center, { opacity: value, transform: [{ translateY: lerp(value, [0, 1], [12, 0]) }, { scale: lerp(value, [0, 1], [0.97, 1]) }] }]}
      pointerEvents={on ? 'box-none' : 'none'}
    >
      {children}
    </Animated.View>
  );
}

function Hint({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const c = usePalette();
  return (
    <View style={styles.hint}>
      <Ionicons name={icon} size={18} color={c.text} />
      <Text style={[styles.hintText, { color: c.text }]}>{text}</Text>
    </View>
  );
}

function IconButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: { position: 'absolute', overflow: 'hidden' },
  stageCard: { borderRadius: 14 },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  buttons: { position: 'absolute', right: 14, height: ROW_H, flexDirection: 'row', justifyContent: 'flex-end' },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 320, borderRadius: 20, padding: 20, gap: 12 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hintText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  primary: { marginTop: 6, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '700' },
  secondary: { height: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  big: { fontSize: 56, fontWeight: '900', letterSpacing: 1 },
  scoreRow: { position: 'absolute', left: 0, right: 0, height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  scorePill: { height: 34, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreText: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  judged: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  judgedText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  result: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  truth: { position: 'absolute', left: 14, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  truthText: { fontSize: 12, fontWeight: '700' },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  pill: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentSoft },
  primary: { backgroundColor: c.accent },
  primaryText: { color: c.onAccent },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
