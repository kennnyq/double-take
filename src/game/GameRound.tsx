import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, AppState, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { WheelGestureDetector, normalizeWheelDelta } from '@/desktop/wheelGesture';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from './config';
import { Countdown } from './Countdown';
import { buildDeck, clipKey } from './deck';
import { useGameDev } from './devOptions';
import { GameStage } from './GameStage';
import { recentClipKeys } from './history';
import { MarkStamp } from './MarkStamp';
import { useEased } from './motion';
import { Pager, slideTo, type Point } from './Pager';
import { createRound, remaining, roundReducer } from './round';
import { roundStats } from './score';
import { gameHistory, setFinishedRound } from './store';
import { TimerBar } from './TimerBar';

const now = () => performance.now();
/** How often the clock checks the deadline and refreshes the readout. */
const TICK_MS = 100;
/** After time is up, the veil shows this long before the results. */
const END_HOLD_MS = 1100;

/** Same test as Home's for the desktop layout. */
function useDesktop() {
  const { width, height } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 760 && height >= 480;
}

/** The `/game` screen: deals a deck, then plays one round. */
export function GameRound() {
  const [deck, setDeck] = useState<{ clip: Clip; truth: 'ai' | 'real' }[] | null>(null);
  const dev = useGameDev();
  useEffect(() => {
    let live = true;
    loadInitialClips().then((clips) => {
      if (!live) return;
      const recent = recentClipKeys(gameHistory.getSnapshot());
      setDeck(buildDeck(clips, { recent }));
    });
    return () => {
      live = false;
    };
  }, []);
  if (!deck) return <View style={styles.root} />;
  return <Round deck={deck} durationMs={dev.roundMs} showTruth={dev.showTruth} />;
}

function Round({ deck, durationMs, showTruth }: { deck: { clip: Clip; truth: 'ai' | 'real' }[]; durationMs: number; showTruth: boolean }) {
  const clips = useMemo(() => deck.map((d) => d.clip), [deck]);
  const [s, dispatch] = useReducer(roundReducer, null, () =>
    createRound(
      deck.map((d) => ({ id: d.clip.id, truth: d.truth })),
      durationMs,
    ),
  );
  const desktop = useDesktop();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const c = usePalette();
  const tint = useTint();

  // Phones: full screen. Desktop: a centred 9:16 column.
  const stageH = desktop ? winH - 48 : winH;
  const stageW = desktop ? Math.min(winW - 48, Math.round((stageH * 9) / 16)) : winW;

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
  // `shown`: the clip the pager is on or sliding to. The round's own index moves
  // at once on a decision; `shown` follows when the slide starts.
  const [shown, setShown] = useState(0);
  const [pos] = useState(() => new Animated.Value(0));
  const [busy, setBusy] = useState(false);
  const [stamps, setStamps] = useState<{ key: number; idx: number; x: number; y: number }[]>([]);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const slideOn = useCallback(
    (from: number, velocity = 0) => {
      const next = from + 1;
      if (next >= clips.length) {
        setBusy(false);
        return;
      }
      setShown(next);
      slideTo(pos, next, velocity, () => {
        setBusy(false);
        // Stamps on cards that have left are off screen now.
        setStamps((st) => st.filter((x) => x.idx >= next - 1));
      });
    },
    [clips.length, pos],
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
      advanceTimer.current = setTimeout(() => slideOn(shown), GAME.markAdvanceMs);
    },
    [canAct, shown, slideOn],
  );

  const skip = useCallback(
    (velocity: number) => {
      if (!canAct) return false;
      dispatch({ type: 'SKIP', now: now(), index: shown });
      setBusy(true);
      slideOn(shown, velocity);
      return true;
    },
    [canAct, shown, slideOn],
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

  // ---- desktop keys and wheel ------------------------------------------------------
  const phaseRef = useRef(s.phase);
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
        markAI({ x: stageW / 2 - 46, y: stageH / 2 - 26 });
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
      e.preventDefault();
      const dir = wheel.push(normalizeWheelDelta(e.deltaY, e.deltaMode, stageH), e.timeStamp);
      if (dir === 1) skip(0);
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
    setFinishedRound({ round: s, stats, newBest, clips: new Map(clips.map((cl) => [cl.id, cl])) });
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
    };
  }, [s, shown, busy]);

  // ---- what shows ------------------------------------------------------------------
  const veilOn = s.phase !== 'playing';
  const veil = useEased(veilOn ? 1 : 0);
  const chrome = useEased(s.phase === 'ready' || s.phase === 'over' ? 0 : 1);
  const readyCard = useEased(s.phase === 'ready' ? 1 : 0);
  const pausedCard = useEased(s.phase === 'paused' ? 1 : 0);
  const overCard = useEased(s.phase === 'over' && s.endReason !== 'quit' ? 1 : 0);
  const countdownOpacity = useEased(s.phase === 'countdown' ? 1 : 0, 220);
  // The readout follows the clock's ticks; the bar runs on its own from the deadline.
  const displayMs = Math.min(s.remainingMs, remaining(s, clock));
  const current = clips[shown];
  const truth = deck[shown]?.truth;

  return (
    <View style={[styles.root, tint.root]}>
      <View style={[styles.stage, { width: stageW, height: stageH, marginTop: desktop ? 24 : 0 }, desktop && styles.stageCard]}>
        <GameStage
          clips={clips}
          index={shown}
          pos={pos}
          width={stageW}
          height={stageH}
          live={playing}
          muted={muted}
          onMutedByBrowser={onMutedByBrowser}
        />
        {stamps.map((st) => (
          <MarkStamp key={st.key} x={st.x} y={st.y} idx={st.idx} pos={pos} height={stageH} />
        ))}
        <Pager index={shown} pos={pos} height={stageH} enabled={canAct} onDoubleTap={markAI} onSwipe={skip} />

        {/* The veil: dims and blurs the waiting clip; fades out at Go. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]} pointerEvents="none">
          {current && <Image source={current.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} />}
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        </Animated.View>

        {/* Top: the clock, sound and quit. */}
        <Animated.View style={[styles.top, { paddingTop: (desktop ? 0 : insets.top) + 10, opacity: chrome }]} pointerEvents="box-none">
          <View style={styles.topRow} pointerEvents="box-none">
            <View style={styles.timer}>
              <TimerBar
                remainingMs={s.remainingMs}
                deadline={s.phase === 'playing' ? s.deadline : null}
                durationMs={s.durationMs}
                displayMs={displayMs}
                judged={s.guesses.length}
              />
            </View>
            <IconButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} />
            <IconButton icon="close" label="Quit round" onPress={askQuit} />
          </View>
        </Animated.View>

        {/* Ready: how to play, and Start. */}
        <Fade value={readyCard} on={s.phase === 'ready'}>
          <View style={[styles.card, tint.card]}>
            <Hint icon="hand-left-outline" text={desktop ? 'Double-click or A: AI' : 'Double tap: AI'} />
            <Hint icon="arrow-up-outline" text={desktop ? 'Scroll or ↓: skip, counts as real' : 'Swipe up: skip, counts as real'} />
            <Pressable onPress={start} style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.primaryText, tint.primaryText]}>Start</Text>
            </Pressable>
            <Pressable onPress={quit} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[styles.secondaryText, tint.dim]}>Back</Text>
            </Pressable>
          </View>
        </Fade>

        {/* 3-2-1 */}
        <Animated.View style={[styles.center, { opacity: countdownOpacity }]} pointerEvents="none">
          {s.phase === 'countdown' && s.countdownEnd !== null && <Countdown endAt={s.countdownEnd} totalMs={GAME.countdownMs} />}
        </Animated.View>

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

        {/* Time's up. */}
        <Fade value={overCard} on={false}>
          <Text style={[styles.big, tint.text]}>{s.endReason === 'deck' ? 'Done' : 'Time'}</Text>
        </Fade>

        {__DEV__ && showTruth && truth && (
          <View style={[styles.truth, { top: (desktop ? 0 : insets.top) + 44 }]} pointerEvents="none">
            <Text style={[styles.truthText, { color: c.textDim }]}>dev: {truth}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** A centred layer that fades with `value`; it takes touches only while `on`. */
function Fade({ value, on, children }: { value: Animated.Value; on: boolean; children: React.ReactNode }) {
  return (
    <Animated.View
      style={[styles.center, { opacity: value, transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
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
  root: { flex: 1, alignItems: 'center', backgroundColor: '#000' },
  stage: { overflow: 'hidden', backgroundColor: '#000' },
  stageCard: { borderRadius: 18 },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timer: { flex: 1, paddingRight: 4 },
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

