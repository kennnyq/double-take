import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, AppState, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Clip } from '@/data/clips';
import { WheelGestureDetector, normalizeWheelDelta } from '@/desktop/wheelGesture';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from './config';
import { buildDeck, clipKey } from './deck';
import { useGameDev } from './devOptions';
import { stageSize, useFrame } from './frame';
import { GameStage, type Stamp } from './GameStage';
import { recentClipKeys } from './history';
import { Countdown } from './hud/Countdown';
import { BUTTONS_W, Hud, ROW_H, ROW_Y, hudAnchor, useTimeFraction } from './hud/Hud';
import { lerp, useEased } from './motion';
import { Pager, slideTo, type Point } from './Pager';
import { loadPlayableClips } from './playable';
import { ResolveText } from './ResolveText';
import { createRound, remaining, roundReducer, type Phase } from './round';
import { roundStats } from './score';
import { gameHistory, setFinishedRound } from './store';

const now = () => performance.now();
/** How often the clock checks the deadline and refreshes the readout. */
const TICK_MS = 100;
/** After time is up, the veil shows this long before the results. */
const END_HOLD_MS = 1300;
/** The countdown flying into the timer (and back out on a resume). */
const MORPH_MS = 560;

type Dealt = { clip: Clip; truth: 'ai' | 'real' };

/** The `/game` screen: deals a deck of clips whose media loads, then plays one round. */
export function GameRound() {
  const [deck, setDeck] = useState<Dealt[] | null>(null);
  const dev = useGameDev();
  const c = usePalette();
  useEffect(() => {
    let live = true;
    loadPlayableClips().then((clips) => {
      if (!live) return;
      const recent = recentClipKeys(gameHistory.getSnapshot());
      setDeck(buildDeck(clips, { recent }));
    });
    return () => {
      live = false;
    };
  }, []);
  if (!deck) return <View style={[styles.root, { backgroundColor: c.bg }]} />;
  return <Round deck={deck} durationMs={dev.roundMs} showTruth={dev.showTruth} designs={dev.designs} />;
}

function Round({ deck, durationMs, showTruth, designs }: { deck: Dealt[]; durationMs: number; showTruth: boolean; designs: ReturnType<typeof useGameDev>['designs'] }) {
  // TODO(feat/gesture-hint): call useBlockHints() from '@/onboarding/store' here once it lands on main.
  const clips = useMemo(() => deck.map((d) => d.clip), [deck]);
  const [s, dispatch] = useReducer(roundReducer, null, () =>
    createRound(
      deck.map((d) => ({ id: d.clip.id, truth: d.truth })),
      durationMs,
    ),
  );
  const frame = useFrame();
  const { width: stageW, height: stageH, marginTop } = stageSize(frame);
  const top = frame.desktop ? 0 : frame.top;
  const tint = useTint();
  const c = usePalette();

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

  // ---- the pager ---------------------------------------------------------------
  // `shown`: the clip the pager is on or moving to. The round's own index moves
  // at once on a decision; `shown` follows when the move starts.
  const [shown, setShown] = useState(0);
  const [pos] = useState(() => new Animated.Value(0));
  // How the clip leaves: 0 up (skip), 1 to the side (mark). Set before each move.
  const [dir] = useState(() => new Animated.Value(0));
  const [busy, setBusy] = useState(false);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const moveOn = useCallback(
    (from: number, velocity = 0) => {
      const next = from + 1;
      if (next >= clips.length) {
        setBusy(false);
        return;
      }
      setShown(next);
      slideTo(pos, next, velocity, () => {
        setBusy(false);
        // The card that left is off the stage in every design: point the next leave up again.
        dir.setValue(0);
        setStamps((st) => st.filter((x) => x.idx >= next - 1));
      });
    },
    [clips.length, pos, dir],
  );

  const playing = s.phase === 'playing';
  const canAct = playing && !busy && s.index === shown;

  const markAI = useCallback(
    (at: Point) => {
      if (!canAct) return;
      dispatch({ type: 'MARK_AI', now: now(), index: shown });
      setBusy(true);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setStamps((st) => [...st, { key: shown, idx: shown, x: at.x, y: at.y }]);
      dir.setValue(1);
      advanceTimer.current = setTimeout(() => moveOn(shown), GAME.markAdvanceMs);
    },
    [canAct, shown, moveOn, dir],
  );

  const skip = useCallback(
    (velocity: number) => {
      if (!canAct) return false;
      dispatch({ type: 'SKIP', now: now(), index: shown });
      setBusy(true);
      moveOn(shown, velocity);
      return true;
    },
    [canAct, shown, moveOn],
  );

  // ---- pausing and quitting -----------------------------------------------------
  const [quitAsked, setQuitAsked] = useState(false);
  const start = () => dispatch({ type: 'START', now: now() });
  const resume = () => {
    setQuitAsked(false);
    dispatch({ type: 'RESUME', now: now() });
  };
  const askQuit = useCallback(() => {
    setQuitAsked(true);
    dispatch({ type: 'PAUSE', now: now() });
  }, []);
  const quit = useCallback(() => {
    dispatch({ type: 'QUIT', now: now() });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  // ---- keys and wheel (browsers) ------------------------------------------------------
  const phaseRef = useRef<Phase>(s.phase);
  useEffect(() => {
    phaseRef.current = s.phase;
  }, [s.phase]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') {
        e.preventDefault();
        if (quitAsked || phaseRef.current === 'ready') quit();
        else askQuit();
      } else if (k === ' ') {
        // Nothing: a stray Space must not count as a guess.
        e.preventDefault();
      } else if (k === 'a' || k === 'A') {
        e.preventDefault();
        markAI({ x: stageW / 2, y: stageH / 2 });
      } else if (k === 'ArrowDown' || k === 'j' || k === 'J') {
        e.preventDefault();
        skip(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markAI, skip, askQuit, quit, quitAsked, stageW, stageH]);

  const [wheel] = useState(() => new WheelGestureDetector());
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onWheel = (e: WheelEvent) => {
      // The rail and the rest of the page keep their own wheel.
      if (e.target instanceof Element && e.target.closest('.rail, [data-own-wheel]')) return;
      e.preventDefault();
      const d = wheel.push(normalizeWheelDelta(e.deltaY, e.deltaMode, stageH), e.timeStamp);
      if (d === 1) skip(0);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [wheel, skip, stageH]);

  // ---- sound ---------------------------------------------------------------------
  // Browsers only allow sound after a gesture, and play starts after the countdown: start muted there.
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const onMutedByBrowser = useCallback(() => setMuted(true), []);

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
    setFinishedRound({ round: s, stats, newBest, best: gameHistory.getSnapshot().best, clips: new Map(clips.map((cl) => [cl.id, cl])) });
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
      designs,
    };
  }, [s, shown, busy, designs]);

  // ---- what shows ------------------------------------------------------------------
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
  const displayMs = Math.min(s.remainingMs, remaining(s, clock));
  const anchor = hudAnchor(designs.hud, stageW, top);
  const current = clips[shown];
  const truth = deck[shown]?.truth;
  const desktop = frame.desktop;

  return (
    <View style={[styles.root, tint.root]}>
      <View style={[styles.stage, { width: stageW, height: stageH, marginTop }, desktop && styles.stageCard]}>
        <GameStage
          clips={clips}
          index={shown}
          pos={pos}
          dir={dir}
          design={designs.transition}
          stamps={stamps}
          width={stageW}
          height={stageH}
          live={playing}
          muted={muted}
          onMutedByBrowser={onMutedByBrowser}
        />
        <Pager index={shown} pos={pos} height={stageH} enabled={canAct} onDoubleTap={markAI} onSwipe={skip} />

        {/* The veil: dims and blurs the waiting clip; fades out at Go. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]} pointerEvents="none">
          {current && <Image source={current.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} />}
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        </Animated.View>

        {/* The timer grows out of where the countdown lands. */}
        <Hud
          design={designs.hud}
          frac={frac}
          durationMs={s.durationMs}
          displayMs={displayMs}
          judged={s.guesses.length}
          width={stageW}
          top={top}
          appear={morph}
        />
        <Countdown
          design={designs.countdown}
          endAt={cdEnd}
          totalMs={GAME.countdownMs}
          width={stageW}
          height={stageH}
          anchor={anchor}
          morph={morph}
          shown={countdownShown}
        />

        {/* The round's buttons: always there. */}
        <View style={[styles.buttons, { top: top + ROW_Y, width: BUTTONS_W }]} pointerEvents="box-none">
          <IconButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} />
          <IconButton icon="close" label="Quit round" onPress={s.phase === 'ready' ? quit : askQuit} />
        </View>

        {/* Ready: how to play, and Start. */}
        <Fade value={readyCard} on={s.phase === 'ready'}>
          <View style={[styles.card, tint.card]}>
            <Hint icon="hand-left-outline" text={desktop ? 'Double-click or A: AI' : 'Double tap: AI'} />
            <Hint icon="arrow-up-outline" text={desktop ? 'Scroll or ↓: skip, counts as real' : 'Swipe up: skip, counts as real'} />
            <Pressable onPress={start} style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.primaryText, tint.primaryText]}>Start</Text>
            </Pressable>
          </View>
        </Fade>

        {/* Paused (the app went to the background, or ✕). */}
        <Fade value={pausedCard} on={s.phase === 'paused'}>
          <View style={[styles.card, tint.card]}>
            <Text style={[styles.title, tint.text]}>{quitAsked ? 'Quit round?' : 'Paused'}</Text>
            <Pressable onPress={resume} style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.primaryText, tint.primaryText]}>Resume</Text>
            </Pressable>
            <Pressable onPress={quit} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
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

        {__DEV__ && showTruth && truth && (
          <View style={[styles.truth, { top: top + ROW_Y + ROW_H + 8 }]} pointerEvents="none">
            <Text style={[styles.truthText, { color: c.textDim }]}>dev: {truth}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

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
  root: { flex: 1, alignItems: 'center' },
  stage: { overflow: 'hidden', backgroundColor: '#000' },
  stageCard: { borderRadius: 18 },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  buttons: { position: 'absolute', right: 0, height: ROW_H, paddingRight: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
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
  truth: { position: 'absolute', left: 14, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  truthText: { fontSize: 12, fontWeight: '700' },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  primary: { backgroundColor: c.accent },
  primaryText: { color: c.onAccent },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
