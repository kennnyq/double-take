import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated as NativeAnimated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { themed, usePalette } from '../../ui/theme';
import { Scrubber } from '../../feed/Scrubber';
import { InfoCard } from '../../feed/InfoCard';
import { CornerCaps } from '../../feed/InspectStage';
import { Spotlight } from '../../feed/Spotlight';
import { useSpotlightMotion } from '../../feed/spotlightMotion';
import { useFadeProgress, useModeProgress } from '../../feed/motion';
import { cardSpot, estimateCardHeight } from '../../feed/card';
import { ownLayer } from '../../feed/layer';
import { easeInOut, planScrub, runScrub, type ScrubPlan } from '../../feed/scrub';
import type { InvestigationEvidence } from '../../investigation/contract';

function playNormal(player: VideoPlayer) { player.playbackRate = 1; player.muted = false; player.play(); }
function scrub(player: VideoPlayer, to: number, done: () => void) {
  player.pause(); player.muted = true;
  return runScrub(player, planScrub(player.currentTime, to), () => { done(); playNormal(player); });
}
/** 0:05, or 0:00.8 for a moment that needs the tenths. */
export function clockTime(t: number, tenths = false) {
  const r = tenths ? Math.round(t * 10) / 10 : Math.round(t);
  const m = Math.floor(r / 60);
  const sec = r - m * 60;
  return `${m}:${tenths ? sec.toFixed(1).padStart(4, '0') : String(sec).padStart(2, '0')}`;
}

type Step = Pick<InvestigationEvidence, 'id' | 'summary' | 'component'> & { tell?: { t0: number; t1: number; box?: { x: number; y: number; w: number; h: number } } };

/**
 * A result's video with the double take's walkthrough: the feed's spotlight
 * and info card over the clip, our scrubber under it, and a row per moment
 * that scrubs there (eased, never a jump) when tapped. Tap the video to play
 * or pause.
 *
 * `pinned` keeps the video and scrubber fixed while the moments and
 * `children` (e.g. the findings) scroll under them; otherwise everything
 * stacks and the parent scrolls.
 */
export function EvidencePlayer({ uri, width, height, duration, preview = false, evidence, maxStageHeight, pinned = false, lead, children }: {
  uri: string; width: number; height: number; duration: number; preview?: boolean; evidence: InvestigationEvidence[];
  /** Fit the video inside a box this tall (e.g. a modal card). */
  maxStageHeight?: number;
  pinned?: boolean;
  /** Shown before the moments (e.g. the verdict on a phone), `children` after them. */
  lead?: ReactNode;
  children?: ReactNode;
}) {
  const styles = useTint();
  const c = usePalette();
  const [progress] = useState(() => new NativeAnimated.Value(0));
  const steps: Step[] = preview ? [
    { id: 'overview', component: 'visuals', summary: 'Start with the whole scene. Watch how the subject moves.', tell: { t0: 0, t1: Math.min(duration, 3) } },
    { id: 'closer', component: 'visuals', summary: 'Look closer at the centre. This is a playback guide, not a finding.', tell: { t0: duration * 0.4, t1: Math.min(duration, duration * 0.4 + 3), box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } },
  ] : evidence;
  const moments = steps.filter(s => s.tell);
  const player = useVideoPlayer(uri, p => { p.timeUpdateEventInterval = 0.1; p.muted = false; p.loop = false; });
  const [active, setActive] = useState<Step>();
  const [card, setCard] = useState<Step>();
  const [leaving, setLeaving] = useState(false);
  const pending = useRef<Step | undefined>(undefined);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [stageW, setStageW] = useState(320);
  const stageH = stageW * height / width;
  const cancel = useRef<(() => void) | undefined>(undefined);
  const barHeld = useRef(false);
  useEffect(() => {
    const sub = player.addListener('timeUpdate', e => {
      setTime(e.currentTime);
      if (!barHeld.current) NativeAnimated.timing(progress, { toValue: duration > 0 ? e.currentTime / duration : 0, duration: 100, useNativeDriver: Platform.OS !== 'web' }).start();
    });
    const play = player.addListener('playingChange', e => setPlaying(e.isPlaying));
    return () => { sub.remove(); play.remove(); cancel.current?.(); progress.stopAnimation(); };
  }, [player, duration, progress]);
  function followScrub(plan: ScrubPlan) {
    const d = player.duration || duration;
    if (!(d > 0) || !(plan.ms > 0)) return;
    const fraction = (t: number) => Math.max(0, Math.min(1, t / d));
    progress.stopAnimation();
    progress.setValue(fraction(plan.from));
    NativeAnimated.timing(progress, { toValue: fraction(plan.to), duration: plan.ms, easing: easeInOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }
  useEffect(() => {
    if (!seeking && active?.tell && time >= active.tell.t1) player.pause();
  }, [active, player, seeking, time]);
  function inspect(item: Step) {
    if (!item.tell) return;
    cancel.current?.(); setActive(item); setSeeking(true);
    pending.current = item;
    if (card) setLeaving(true); else setCard(item);
    cancel.current = scrub(player, item.tell.t0, () => setSeeking(false));
  }
  function endWalkthrough() {
    cancel.current?.(); setSeeking(false); setActive(undefined); pending.current = undefined;
    if (card) setLeaving(true);
  }
  function togglePlay() {
    if (playing && !seeking) { player.pause(); return; }
    endWalkthrough();
    if (player.duration > 0 && player.currentTime >= player.duration - 0.05) {
      // At the end: rewind visibly rather than jumping back to the start.
      cancel.current = scrub(player, 0, () => setSeeking(false));
      setSeeking(true);
    } else playNormal(player);
  }
  const tell = active?.tell;
  // The 100 ms playback event can pause just beyond the end; retain the final region.
  const box = !seeking && tell && time >= tell.t0 && time <= tell.t1 + 0.15 ? tell.box : undefined;
  const area = box ? { x: box.x * stageW, y: box.y * stageH, w: box.w * stageW, h: box.h * stageH } : null;
  const motion = useSpotlightMotion(area, 'rounded');
  const mode = useModeProgress(!!active);
  const paused = useFadeProgress(!playing && !seeking && !card, 200);
  const playHint = useAnimatedStyle(() => ({ opacity: paused.value, transform: [{ scale: 0.9 + paused.value * 0.1 }] }));
  const cardIndex = card ? Math.max(0, moments.findIndex(s => s.id === card.id)) : 0;
  const cardHint = preview ? 'Playback guide' : card?.component === 'audio' ? 'Listen' : 'Look closer';
  const cardBox = card?.tell?.box;
  const hole = cardBox ? { x: cardBox.x * stageW, y: cardBox.y * stageH, w: cardBox.w * stageW, h: cardBox.h * stageH } : null;
  const spot = card ? cardSpot({ hole, placement: 'bottom', stageW, stageH, cardH: estimateCardHeight(card.summary, Math.min(320, stageW - 24)) + 44, safeTop: 10, safeBottom: 10, gap: 14 }) : null;

  const stage = (
    <View style={{ width: '100%', maxWidth: Math.min(height > width ? 340 : 672, maxStageHeight ? maxStageHeight * width / height : Infinity), alignSelf: 'center', gap: 4 }}>
      <View onLayout={e => setStageW(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: width / height, backgroundColor: '#000' }}>
        <VideoView player={player} nativeControls={false} playsInline contentFit="contain" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
        <CornerCaps radius={16} progress={mode} />
        <Spotlight motion={motion} stageW={stageW} stageH={stageH} effect="darken" strength={2} shape="rounded" player={player} />
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={togglePlay} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Animated.View pointerEvents="none" style={[styles.playHint, ownLayer, playHint]}>
            <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} />
          </Animated.View>
        </Pressable>
        {card && spot && <InfoCard key={card.id} stageH={stageH} spot={spot} text={card.summary} hint={cardHint} nav={{ step: cardIndex, count: moments.length, onBack: () => inspect(moments[Math.max(0, cardIndex - 1)]), onNext: () => { const next = moments[cardIndex + 1]; if (next) inspect(next); else endWalkthrough(); }, cue: 'done' }} leaving={leaving} onGone={() => { setCard(pending.current); setLeaving(false); }} />}
      </View>
      <Scrubber player={player} progress={progress} width={stageW} enabled={!seeking} onHold={on => { if (on && !barHeld.current) progress.stopAnimation(); barHeld.current = on; if (on) player.pause(); }} onFollow={followScrub} onDrag={() => {}} />
    </View>
  );

  // Only real evidence gets a walkthrough and rows; with none, there's just the video.
  const list = moments.length > 0 && (
    <View style={{ gap: 8 }}>
      <View style={styles.listHead}>
        <Text style={styles.heading}>{preview ? 'Where to look' : 'Moments to look at'}</Text>
        <Pressable accessibilityRole="button" onPress={() => (active ? endWalkthrough() : inspect(moments[0]))} hitSlop={8} style={({ pressed }) => [styles.walk, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name={active ? 'stop' : 'play'} size={12} color={c.onAccent} />
          <Text style={styles.walkText}>{active ? 'Stop' : 'Walk me through it'}</Text>
        </Pressable>
      </View>
      {moments.map(item => <MomentRow key={item.id} item={item} active={active?.id === item.id} onPress={() => inspect(item)} />)}
    </View>
  );

  if (pinned) {
    // The pinned video sits on its own opaque band, and what scrolls up under it fades out just
    // below that band, so a line never looks sliced by the video's bottom edge.
    const clear = /^#[0-9a-f]{6}$/i.test(c.surface) ? `${c.surface}00` : 'transparent';
    return (
      <View style={{ flex: 1 }}>
        <View style={[styles.pinned, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }]}>{stage}</View>
        <View style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 14, gap: 24 }}>
            {lead}
            {list}
            {children}
          </ScrollView>
          <LinearGradient pointerEvents="none" colors={[c.surface, clear]} style={styles.fade} />
        </View>
      </View>
    );
  }
  return <View style={{ gap: 20 }}>{stage}{lead}{list}{children}</View>;
}

/** A moment of the walkthrough: when, what to look at; tapping it scrubs there. The active one lights up. */
function MomentRow({ item, active, onPress }: { item: Step; active: boolean; onPress: () => void }) {
  const styles = useTint();
  const c = usePalette();
  const lit = useFadeProgress(active, 220);
  const glow = useAnimatedStyle(() => ({ opacity: lit.value * 0.45 }));
  const tell = item.tell!;
  const when = clockTime(tell.t0, Math.abs(tell.t0 - Math.round(tell.t0)) >= 0.05);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.component === 'audio' ? 'Listen' : 'Watch'} at ${when}: ${item.summary}`} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rowLit, ownLayer, glow]} />
      <View style={styles.when}>
        <Ionicons name={item.component === 'audio' ? 'ear-outline' : 'eye-outline'} size={14} color={c.text} />
        <Text style={styles.whenText}>{when}</Text>
      </View>
      <Text style={[styles.text, { flex: 1 }]}>{item.summary}</Text>
    </Pressable>
  );
}

const useTint = themed(c => ({
  text: { color: c.text, fontSize: 15, lineHeight: 21 },
  heading: { color: c.text, fontSize: 15, fontWeight: '600' },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 2 },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  walkText: { color: c.onAccent, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, backgroundColor: c.surfaceRaised },
  rowLit: { borderRadius: 12, backgroundColor: c.accentSoft },
  when: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 62, paddingTop: 2 },
  whenText: { color: c.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pinned: { backgroundColor: c.surface, zIndex: 1 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, height: 18 },
  playHint: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
}));
