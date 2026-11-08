import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { readTellsFile, type UnplacedClaim } from '@/annotations/format';
import { boxShownAt, replayWindow, stepCopy, walkthroughSteps, type Replay } from '@/annotations/walkthrough';
import type { TellsVariant } from '@/data/clips';
import { variantIndex } from '@/devtools/settings';
import { DEV_TOOLS, useDevSettings } from '@/devtools/store';
import { themed, usePalette } from '@/ui/theme';
import { boxOnStage, cardPlacement, videoRect, type Box, type Fit, type Tell } from './tells';

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
  /** Distance of the Close chip from the top of the stage. */
  top: number;
  paused: boolean;
  onPause: () => void;
  onPlay: () => void;
  /** Slow-motion, muted playback for the replay loops. */
  onSlowmo: (on: boolean) => void;
  /** The walkthrough started or ended: the clip shows the whole frame and hides its chrome meanwhile. */
  onInspect: (on: boolean) => void;
}

interface Loaded {
  steps: Tell[];
  /** Claims with no place on the video; shown on a closing card. */
  unplaced: UnplacedClaim[];
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

/** Seeking is a property write on the player; kept out of the component body. */
function seekTo(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

/** How often the player reports time: finer during the walkthrough, so short boxes don't get skipped. */
function setTick(player: VideoPlayer, seconds: number) {
  player.timeUpdateEventInterval = seconds;
}
const TICK_WALKTHROUGH = 0.1;
const TICK_FEED = 0.25; // what Feed sets up

/** Taps this soon after the walkthrough opens belong to the opening gesture. */
const OPEN_SETTLE_MS = 350;

/** Taps on the left edge go back a step, like stories. */
const BACK_ZONE = 0.28;

/**
 * The double take: a tap-through walkthrough of the clip's tells, started by
 * holding or double-tapping the video (see `TellOverlayHandle`).
 *
 * Each step loops a short stretch around the tell in slow motion (a paused
 * frame hides motion artifacts), outlines the spot and gives the reason. Tap
 * to go on, tap the left edge to go back, hold to pause. Automatic drafts are
 * marked as such. Mounted only for the active clip, so every visit starts closed.
 */
export function TellOverlay({ ref, ...p }: Props) {
  const settings = useDevSettings();
  const c = usePalette();
  const tint = useTint();
  // One pipeline ("model") for every clip, picked in the dev settings; main if this clip lacks it.
  const variant = variantIndex(p.variants, settings.pipeline);
  const [step, setStep] = useState<number | null>(null); // null: closed, -1: nothing to show
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  const [now, setNow] = useState(0);
  const replay = useRef<Replay | null>(null);
  const held = useRef(false);
  // When the walkthrough opened: the tail of the gesture that opened it (the
  // second tap's click on web) must not land on the tap zones and skip a step.
  const settling = useRef(false);
  const { player, onInspect, onSlowmo } = p;

  // Leaving the clip unmounts us; make sure the clip goes back to normal.
  useEffect(
    () => () => {
      onInspect(false);
      onSlowmo(false);
      if (player) setTick(player, TICK_FEED);
    },
    [onInspect, onSlowmo, player],
  );

  const url = p.variants[variant]?.url;
  const data = (url && cache[url]) || null;
  const steps = data?.steps ?? [];
  const unplaced = data?.unplaced ?? [];
  const count = steps.length + (unplaced.length ? 1 : 0);

  const goTo = (i: number, d: Loaded) => {
    setStep(i);
    const tell = d.steps[i];
    if (tell && player) {
      const r = replayWindow(tell, player.duration);
      replay.current = r;
      seekTo(player, r.from);
      setNow(r.from);
      setTick(player, TICK_WALKTHROUGH);
      onSlowmo(true);
    } else {
      replay.current = null;
      onSlowmo(false);
    }
    p.onPlay();
    Haptics.selectionAsync().catch(() => {});
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
      setStep(-1); // "No tells found", for a moment
      setTimeout(() => setStep((s) => (s === -1 ? null : s)), 1600);
      return;
    }
    onInspect(true);
    settling.current = true;
    setTimeout(() => (settling.current = false), OPEN_SETTLE_MS);
    goTo(0, d);
  };

  function close() {
    setStep(null);
    replay.current = null;
    if (player) setTick(player, TICK_FEED);
    onSlowmo(false);
    onInspect(false);
    p.onPlay();
  }
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  const next = () => {
    if (!data || step === null || settling.current) return;
    if (step + 1 < count) goTo(step + 1, data);
    else close();
  };
  const back = () => {
    if (data && step !== null && step > 0 && !settling.current) goTo(step - 1, data);
  };

  // Keep the replay inside its loop (the clip's own loop can also wrap it to 0).
  const onTime = (time: number) => {
    setNow(time);
    const r = replay.current;
    if (r && player && (time >= r.to || time < r.from - 0.3)) seekTo(player, r.from);
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
  useImperativeHandle(
    ref,
    () => ({ open: () => void openRef.current(), close: () => closeRef.current() }),
    [],
  );

  // A new pick in the dev settings ends a walkthrough of the old pipeline's tells.
  const shownUrl = useRef(url);
  useEffect(() => {
    if (shownUrl.current === url) return;
    shownUrl.current = url;
    if (step !== null) closeRef.current();
  }, [url, step]);

  const inStep = step !== null && step >= 0;
  const current = inStep && step < steps.length ? steps[step] : undefined;
  const onSummary = inStep && step === steps.length && unplaced.length > 0;
  const frame = videoRect(p.stageW, p.stageH, p.aspect, p.fit);
  const rect = current?.box && boxShownAt(current, now) ? boxOnStage(current.box, frame, p.stageW, p.stageH) : null;
  // Card placement follows the box's spot even while the box is hidden, so the card doesn't jump each loop.
  const spot = current?.box ? boxOnStage(current.box, frame, p.stageW, p.stageH) : null;
  const cardH = 150;
  const placement = cardPlacement(spot, p.stageH, cardH, p.top + 44);
  const cardStyle = placement === 'top' ? { top: p.top + 44 } : { bottom: 16 };
  const last = inStep && step + 1 >= count;
  // Dev builds: which model's tells these are, and whether this clip fell back to main.
  const shown = p.variants[variant]?.name;
  const devSource = !DEV_TOOLS ? '' : ` · ${shown}${shown !== settings.pipeline ? ` (no ${settings.pipeline})` : ''}`;

  return (
    <>
      {player && inStep && <PlayerClock player={player} onTime={onTime} />}
      {inStep && (
        <>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {rect && <Spotlight rect={rect} stageW={p.stageW} stageH={p.stageH} />}
            {rect && <View style={[styles.box, tint.box, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]} />}
          </View>
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
          {current && (
            <Callout
              index={step}
              count={count}
              title={current.label}
              body={current.detail}
              tag={tagFor(current, step, count)}
              hint={`Slow-mo replay · tap to ${last ? 'finish' : 'continue'}${devSource}`}
              style={cardStyle}
            />
          )}
          {onSummary && (
            <Callout
              index={step}
              count={count}
              title="Also noted"
              lines={unplaced.slice(0, 3).map((u) => u.quote)}
              tag="AI draft"
              hint={`Not shown on screen · tap to finish${devSource}`}
              style={{ bottom: 16 }}
            />
          )}
        </>
      )}

      {step !== null ? (
        <Pressable
          onPress={close}
          disabled={step === -1}
          style={({ pressed }) => [styles.pill, styles.pillLeft, { top: p.top }, tint.pillOn, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={step === -1 ? 'No tells found' : 'Close the walkthrough'}
        >
          <Ionicons name={step === -1 ? 'eye-off-outline' : 'close'} size={15} color={c.onTell} />
          <Text style={[styles.pillText, tint.pillTextOn]}>{step === -1 ? 'No tells found' : 'Close'}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** The reason for one step, attached to the walkthrough rather than to buttons. */
function Callout(props: {
  index: number;
  count: number;
  title: string;
  body?: string;
  lines?: string[];
  /** Small status at the top right, e.g. "AI draft". */
  tag?: string;
  hint: string;
  style: object;
}) {
  const tint = useTint();
  return (
    <View style={[styles.card, props.style]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={styles.cardHead}>
        <View style={styles.progress}>
          {Array.from({ length: props.count }, (_, i) => (
            <View key={i} style={[styles.seg, i <= props.index && tint.segOn]} />
          ))}
        </View>
        {props.tag ? <Text style={styles.tag}>{props.tag}</Text> : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {props.title}
      </Text>
      {props.body ? (
        <Text style={styles.body} numberOfLines={3}>
          {props.body}
        </Text>
      ) : null}
      {props.lines?.map((l, i) => (
        <Text key={i} style={styles.body} numberOfLines={2}>
          • {l}
        </Text>
      ))}
      <Text style={styles.hint}>{props.hint}</Text>
    </View>
  );
}

function tagFor(t: Tell, i: number, n: number): string | undefined {
  const c = stepCopy(t, i, n);
  if (!c.unverified) return undefined;
  return c.doubtful ? 'AI draft · unsure' : 'AI draft';
}

/** Reports playback time; a component so the listener only exists while there's a player. */
function PlayerClock({ player, onTime }: { player: VideoPlayer; onTime: (t: number) => void }) {
  useEventListener(player, 'timeUpdate', (e) => onTime(e.currentTime));
  return null;
}

/** Darkens everything but the box. */
function Spotlight({ rect: r, stageW, stageH }: { rect: Box; stageW: number; stageH: number }) {
  return (
    <>
      <View style={[styles.scrim, { left: 0, top: 0, width: stageW, height: r.y }]} />
      <View style={[styles.scrim, { left: 0, top: r.y + r.h, width: stageW, height: stageH - r.y - r.h }]} />
      <View style={[styles.scrim, { left: 0, top: r.y, width: r.x, height: r.h }]} />
      <View style={[styles.scrim, { left: r.x + r.w, top: r.y, width: stageW - r.x - r.w, height: r.h }]} />
    </>
  );
}


const styles = StyleSheet.create({
  // Each pill sets only its own side: on web, `left: undefined` doesn't cancel a `left` set earlier.
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pillLeft: { left: 12 },
  pressed: { opacity: 0.7 },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  scrim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.4)' },
  box: {
    position: 'absolute',
    borderWidth: 2.5,
    borderRadius: 8,
  },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
    borderRadius: 16,
    backgroundColor: 'rgba(16,16,18,0.88)',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  tag: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  body: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 19 },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
});

const useTint = themed((c) => ({
  pillOn: { backgroundColor: c.tell, borderColor: c.tell },
  pillTextOn: { color: c.onTell },
  box: { borderColor: c.tell },
  segOn: { backgroundColor: c.tell },
}));
