import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { readTellsFile, type UnplacedClaim } from '@/annotations/format';
import { replayWindow, stepCopy, walkthroughSteps, type Replay } from '@/annotations/walkthrough';
import type { TellsVariant } from '@/data/clips';
import { variantIndex } from '@/devtools/settings';
import { useDevSettings } from '@/devtools/store';
import './devSection';
import { cardSpot, emptierSide, estimateCardHeight, type CardSpot } from './card';
import { InfoCard } from './InfoCard';
import { planScrub, runScrub } from './scrub';
import { Spotlight } from './Spotlight';
import { grow, holeFor, type Rect } from './spotlight';
import { boxOnStage, videoRect, type Fit, type Tell } from './tells';

/** Lets the clip's Double take button and gestures (a user setting) open and close the walkthrough. */
export interface TellOverlayHandle {
  open: () => void;
  close: () => void;
}

interface Props {
  ref?: React.Ref<TellOverlayHandle>;
  /** The clip's tells files (signed URLs), main first. The dev settings pick one for every clip. */
  variants: TellsVariant[];
  player: VideoPlayer | null;
  stageW: number;
  stageH: number;
  aspect: number;
  /** How the video is fitted right now (the walkthrough asks for `contain`). */
  fit: Fit;
  /** Distance of the Close button from the top of the stage. */
  top: number;
  paused: boolean;
  onPause: () => void;
  onPlay: () => void;
  /** Slow-motion, muted playback for the replay loops. */
  onSlowmo: (on: boolean) => void;
  /** A scrub (fast-forward or rewind) is driving the player: hold it paused and muted meanwhile. */
  onScrub: (on: boolean) => void;
  /** The walkthrough started or ended: the clip shows the whole frame and hides its chrome meanwhile. */
  onInspect: (on: boolean) => void;
}

interface Loaded {
  steps: Tell[];
  /** Claims with no place on the video; shown on a closing card. */
  unplaced: UnplacedClaim[];
}

interface Card {
  key: number;
  spot: CardSpot;
  text: string;
  hint?: string;
  loop: boolean;
  leaving: boolean;
}

const EMPTY: Loaded = { steps: [], unplaced: [] };

async function loadTells(url: string): Promise<Loaded> {
  try {
    const res = await fetch(url); // signed URL, so no auth header
    if (!res.ok) return EMPTY;
    const file = readTellsFile(await res.json());
    return { steps: walkthroughSteps(file.tells), unplaced: file.unplaced ?? [] };
  } catch {
    return EMPTY;
  }
}

/** The loop restart: the one place the walkthrough sets the time directly. */
function restartLoop(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
  if (__DEV__ && Platform.OS === 'web' && typeof window !== 'undefined') {
    // For the browser check (scripts/e2e/double-take-flow.ts): jumps are only allowed here.
    const w = window as unknown as { __dtLoopRestarts?: number[] };
    (w.__dtLoopRestarts ??= []).push(performance.now());
  }
}

/** How often the player reports time: finer during the walkthrough, so the loop line moves smoothly. */
function setTick(player: VideoPlayer, seconds: number) {
  player.timeUpdateEventInterval = seconds;
}
const TICK_WALKTHROUGH = 0.1;
const TICK_FEED = 0.25; // what Feed sets up

/** Taps this soon after the walkthrough opens belong to the opening gesture. */
const OPEN_SETTLE_MS = 350;

/** Taps on the left edge go back a step, like stories. */
const BACK_ZONE = 0.28;

/** How long "No tells found" stays up. */
const EMPTY_MS = 1600;

let cardKeys = 0;

/**
 * The double take: a tap-through walkthrough of the clip's tells, started by
 * holding or double-tapping the video (see `TellOverlayHandle`).
 *
 * Each step fast-forwards (or rewinds) to its tell, then loops a short stretch
 * around it in slow motion: the spotlight darkens and/or blurs everything but
 * the tell's area, and a small card floats next to it with the reason and a
 * faint line for the loop's progress. Tap to go on, tap the left edge to go
 * back, hold to pause. Nothing jumps: the video scrubs between tells, the
 * spotlight eases between areas and cards morph in and out. The loop restart
 * is the only jump. Mounted only for the active clip, so every visit starts closed.
 */
export function TellOverlay({ ref, ...p }: Props) {
  const settings = useDevSettings();
  // One pipeline ("model") for every clip, picked in the dev settings; main if this clip lacks it.
  const variant = variantIndex(p.variants, settings.pipeline);
  const [step, setStep] = useState<number | null>(null); // null: closed, -1: nothing to show
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  const [cards, setCards] = useState<Card[]>([]);
  const [scrubbing, setScrubbing] = useState(false);
  const [now, setNow] = useState(0);
  const replay = useRef<Replay | null>(null);
  const cancelScrub = useRef<() => void>(() => {});
  const held = useRef(false);
  // When the walkthrough opened: the tail of the gesture that opened it (the
  // second tap's click on web) must not land on the tap zones and skip a step.
  const settling = useRef(false);
  const loop = useSharedValue(0);
  const shown = useSharedValue(0);
  const { player, onInspect, onSlowmo, onScrub } = p;

  // Leaving the clip unmounts us; make sure the clip goes back to normal.
  useEffect(
    () => () => {
      cancelScrub.current();
      onScrub(false);
      onInspect(false);
      onSlowmo(false);
      if (player) setTick(player, TICK_FEED);
    },
    [onInspect, onSlowmo, onScrub, player],
  );

  const url = p.variants[variant]?.url;
  const data = (url && cache[url]) || null;
  const steps = data?.steps ?? [];
  const unplaced = data?.unplaced ?? [];
  const count = steps.length + (unplaced.length ? 1 : 0);

  // ---- geometry -------------------------------------------------------------
  const frame = videoRect(p.stageW, p.stageH, p.aspect, p.fit);
  const areaOf = (t: Tell | undefined): Rect | null => (t?.box ? boxOnStage(t.box, frame, p.stageW, p.stageH) : null);
  const safeTop = p.top + 46;
  const safeBottom = 20;

  const spotFor = (d: Loaded, i: number, text: string): CardSpot => {
    const tell = d.steps[i];
    const area = areaOf(tell);
    // Keep the card clear of the spotlight's soft edge too.
    const hole = area ? grow(holeFor(area, settings.spotlightShape), holeFor(area, settings.spotlightShape).feather / 2) : null;
    const others = d.steps.map(areaOf).filter((r): r is Rect => !!r);
    const placement = tell?.placement ?? emptierSide(frame, p.stageH, others);
    const width = Math.min(320, p.stageW - 24);
    return cardSpot({
      hole,
      placement,
      stageW: p.stageW,
      stageH: p.stageH,
      cardH: estimateCardHeight(text, width),
      safeTop,
      safeBottom,
    });
  };

  const showCard = (card: Omit<Card, 'key' | 'leaving'>) =>
    setCards((cs) => [...cs.map((c) => ({ ...c, leaving: true })), { ...card, key: ++cardKeys, leaving: false }]);
  const leaveCards = () => setCards((cs) => (cs.some((c) => !c.leaving) ? cs.map((c) => ({ ...c, leaving: true })) : cs));
  const dropCard = (key: number) => setCards((cs) => cs.filter((c) => c.key !== key));

  const cardFor = (d: Loaded, i: number) => {
    const n = d.steps.length + (d.unplaced.length ? 1 : 0);
    const last = i + 1 >= n;
    const tap = `Tap to ${last ? 'finish' : 'continue'}`;
    const tell = d.steps[i];
    if (tell) {
      const c = stepCopy(tell, i, n);
      const text = tell.detail ?? tell.label;
      // Model drafts nobody checked stay marked, quietly, in the hint line.
      const hint = c.unverified ? `${c.doubtful ? 'Unsure AI draft' : 'AI draft'} · ${tap}` : tap;
      return { spot: spotFor(d, i, text), text, hint, loop: true };
    }
    const text = d.unplaced
      .slice(0, 3)
      .map((u) => `“${u.quote}”`)
      .join('\n');
    return { spot: spotFor(d, i, text), text, hint: `Not shown on screen · ${tap}`, loop: false };
  };

  // ---- steps ----------------------------------------------------------------
  const goTo = (i: number, d: Loaded) => {
    cancelScrub.current();
    leaveCards();
    setStep(i);
    const tell = d.steps[i];
    Haptics.selectionAsync().catch(() => {});
    if (!tell || !player) {
      // The closing "Also noted" card: plain playback under it.
      replay.current = null;
      setScrubbing(false);
      onSlowmo(false);
      onScrub(false);
      p.onPlay();
      showCard(cardFor(d, i));
      return;
    }
    const r = replayWindow(tell, player.duration);
    // No looping while the scrub runs; it fast-forwards or rewinds to the loop's start.
    replay.current = null;
    setTick(player, TICK_WALKTHROUGH);
    setScrubbing(true);
    onScrub(true);
    loop.value = withTiming(0, { duration: 200 });
    const card = cardFor(d, i);
    cancelScrub.current = runScrub(player, planScrub(player.currentTime, r.from), () => {
      cancelScrub.current = () => {};
      replay.current = r;
      setNow(r.from);
      setScrubbing(false);
      onSlowmo(true);
      onScrub(false);
      p.onPlay();
      showCard(card);
    });
  };

  const open = async () => {
    const u = url;
    if (!u || step !== null) return;
    let d = cache[u];
    if (!d) {
      d = await loadTells(u);
      setCache((c) => ({ ...c, [u]: d }));
    }
    if (!d.steps.length && !d.unplaced.length) {
      setStep(-1);
      showCard({ spot: cardSpot({ hole: null, placement: 'top', stageW: p.stageW, stageH: p.stageH, cardH: 60, safeTop: p.top, safeBottom }), text: 'No tells found for this clip', loop: false });
      setTimeout(() => {
        leaveCards();
        setStep((s) => (s === -1 ? null : s));
      }, EMPTY_MS);
      return;
    }
    onInspect(true);
    shown.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    settling.current = true;
    setTimeout(() => (settling.current = false), OPEN_SETTLE_MS);
    goTo(0, d);
  };

  function close() {
    cancelScrub.current();
    cancelScrub.current = () => {};
    replay.current = null;
    leaveCards();
    setStep(null);
    setScrubbing(false);
    shown.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    if (player) setTick(player, TICK_FEED);
    // Playback carries on from wherever the loop is: no jump back.
    onScrub(false);
    onSlowmo(false);
    onInspect(false);
    p.onPlay();
  }
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  const next = () => {
    if (!data || step === null || step < 0 || settling.current) return;
    if (step + 1 < count) goTo(step + 1, data);
    else close();
  };
  const back = () => {
    if (data && step !== null && step > 0 && !settling.current) goTo(step - 1, data);
  };

  // Keep the replay inside its loop; the loop line follows it (and restarts with it).
  const onTime = (time: number) => {
    setNow(time);
    const r = replay.current;
    if (!r || !player) return;
    // The clip's own loop can also wrap it to 0.
    if (time >= r.to || time < r.from - 0.3) {
      restartLoop(player, r.from);
      loop.value = 0;
      return;
    }
    const len = Math.max(0.1, r.to - r.from);
    const frac = Math.min(1, Math.max(0, (time - r.from) / len));
    const ahead = Math.min(1, frac + (TICK_WALKTHROUGH * (player.playbackRate || 0.35)) / len);
    loop.value = withTiming(ahead, { duration: TICK_WALKTHROUGH * 1000, easing: Easing.linear });
  };

  const holdToPause = {
    onLongPress: () => {
      held.current = true;
      p.onPause();
    },
    delayLongPress: 300,
    onPressOut: () => {
      if (!held.current) return;
      // Let the press finish before clearing, so the release isn't also a tap.
      setTimeout(() => (held.current = false), 0);
      p.onPlay();
    },
  };

  // The clip's gesture calls the latest `open`, which knows the current step and pipeline.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useImperativeHandle(ref, () => ({ open: () => void openRef.current(), close: () => closeRef.current() }), []);

  // A new pick in the dev settings ends a walkthrough of the old pipeline's tells.
  const shownUrl = useRef(url);
  useEffect(() => {
    if (shownUrl.current === url) return;
    shownUrl.current = url;
    if (step !== null && step >= 0) closeRef.current();
  }, [url, step]);

  const inStep = step !== null && step >= 0;
  const current = inStep && step < steps.length ? steps[step] : undefined;
  const last = inStep && step + 1 >= count;
  // The spotlight follows the step's area, during the scrub too (it eases there
  // while the video runs to it). A box pinned to a camera shot means nothing
  // across a cut, so it lets go outside that shot.
  const inShot = !current?.shot || scrubbing || (now >= current.shot.t0 - 0.05 && now <= current.shot.t1 + 0.05);
  const area = inShot ? areaOf(current) : null;

  const closeStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.85 + 0.15 * shown.value }] }));

  return (
    <>
      {player && inStep && <PlayerClock player={player} onTime={onTime} />}
      <Spotlight
        area={area}
        stageW={p.stageW}
        stageH={p.stageH}
        mode={settings.spotlight}
        strength={settings.spotlightStrength}
        shape={settings.spotlightShape}
      />
      {inStep && (
        <>
          {/* Two tap zones, like stories: the left edge goes back, the rest goes on. Hold either to pause. */}
          <Pressable
            style={[StyleSheet.absoluteFill, step > 0 && { left: p.stageW * BACK_ZONE }]}
            onPress={() => !held.current && next()}
            {...holdToPause}
            accessibilityRole="button"
            accessibilityLabel={last ? 'Finish the walkthrough' : 'Next tell'}
            accessibilityHint="Hold to pause"
          />
          {step > 0 && (
            <Pressable
              style={[StyleSheet.absoluteFill, { right: undefined, width: p.stageW * BACK_ZONE }]}
              onPress={() => !held.current && back()}
              {...holdToPause}
              accessibilityRole="button"
              accessibilityLabel="Previous tell"
            />
          )}
        </>
      )}
      {cards.map((c) => (
        <InfoCard
          key={c.key}
          spot={c.spot}
          text={c.text}
          hint={c.hint}
          loop={c.loop ? loop : null}
          leaving={c.leaving}
          onGone={() => dropCard(c.key)}
        />
      ))}
      <Animated.View style={[styles.closeWrap, { top: p.top }, closeStyle]} pointerEvents={inStep ? 'box-none' : 'none'}>
        <Pressable
          onPress={close}
          disabled={!inStep}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={inStep ? 'Close the walkthrough' : undefined}
          accessibilityElementsHidden={!inStep}
        >
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </Animated.View>
    </>
  );
}

/** Reports playback time; a component so the listener only exists while there's a player. */
function PlayerClock({ player, onTime }: { player: VideoPlayer; onTime: (t: number) => void }) {
  useEventListener(player, 'timeUpdate', (e) => onTime(e.currentTime));
  return null;
}

const styles = StyleSheet.create({
  closeWrap: { position: 'absolute', left: 12 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,22,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pressed: { opacity: 0.6 },
});
