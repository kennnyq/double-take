import { useEffect, useRef, useState } from 'react';
import { Animated as NativeAnimated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { themed } from '../../ui/theme';
import { Scrubber } from '../../feed/Scrubber';
import { InfoCard } from '../../feed/InfoCard';
import { CornerCaps } from '../../feed/InspectStage';
import { Spotlight } from '../../feed/Spotlight';
import { useSpotlightMotion } from '../../feed/spotlightMotion';
import { useModeProgress } from '../../feed/motion';
import { easeInOut, planScrub, runScrub, type ScrubPlan } from '../../feed/scrub';
import type { InvestigationEvidence } from '../../investigation/contract';

function playNormal(player: VideoPlayer) { player.playbackRate = 1; player.muted = false; player.play(); }
function scrub(player: VideoPlayer, to: number, done: () => void) {
  player.pause(); player.muted = true;
  return runScrub(player, planScrub(player.currentTime, to), () => { done(); playNormal(player); });
}
type Step = Pick<InvestigationEvidence, 'id' | 'summary' | 'component'> & { tell?: { t0: number; t1: number; box?: { x: number; y: number; w: number; h: number } } };
export function EvidencePlayer({ uri, width, height, duration, preview = false, evidence }: { uri: string; width: number; height: number; duration: number; preview?: boolean; evidence: InvestigationEvidence[] }) {
  const styles = useTint();
  const [progress] = useState(() => new NativeAnimated.Value(0));
  const steps: Step[] = preview ? [
    { id: 'overview', component: 'visuals', summary: 'Start with the whole scene. Watch how the subject moves.', tell: { t0: 0, t1: Math.min(duration, 3) } },
    { id: 'closer', component: 'visuals', summary: 'Look closer at the centre. This is a playback guide, not a finding.', tell: { t0: duration * 0.4, t1: Math.min(duration, duration * 0.4 + 3), box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } },
  ] : evidence;
  const player = useVideoPlayer(uri, p => { p.timeUpdateEventInterval = 0.1; p.muted = false; p.loop = false; });
  const [active, setActive] = useState<Step>();
  const [card, setCard] = useState<Step>();
  const [leaving, setLeaving] = useState(false);
  const pending = useRef<Step | undefined>(undefined);
  const [time, setTime] = useState(0);
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
    return () => { sub.remove(); cancel.current?.(); progress.stopAnimation(); };
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
  const tell = active?.tell;
  // The 100 ms playback event can pause just beyond the end; retain the final region.
  const box = !seeking && tell && time >= tell.t0 && time <= tell.t1 + 0.15 ? tell.box : undefined;
  const area = box ? { x: box.x * stageW, y: box.y * stageH, w: box.w * stageW, h: box.h * stageH } : null;
  const motion = useSpotlightMotion(area, 'rounded');
  const mode = useModeProgress(!!active);
  return <View style={{ gap: 16 }}>
    <View style={{ width: '100%', maxWidth: height > width ? 340 : 672, alignSelf: 'center' }}>
    <View onLayout={e => setStageW(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: width / height, backgroundColor: '#000' }}>
      <VideoView player={player} nativeControls={false} playsInline contentFit="contain" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
      <CornerCaps radius={16} progress={mode} />
      <Spotlight motion={motion} stageW={stageW} stageH={stageH} effect="darken" strength={2} shape="rounded" player={player} />
    </View>
    <Scrubber player={player} progress={progress} width={stageW} enabled={!seeking} onHold={on => { if (on && !barHeld.current) progress.stopAnimation(); barHeld.current = on; if (on) player.pause(); }} onFollow={followScrub} onDrag={() => {}} />
    </View>
    <View style={{ flexDirection: 'row', gap: 24 }}>
      <Pressable accessibilityRole="button" onPress={() => { cancel.current?.(); setSeeking(false); setActive(undefined); pending.current = undefined; setLeaving(true); playNormal(player); }}><Text style={styles.control}>Play</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { cancel.current?.(); setSeeking(false); player.pause(); }}><Text style={styles.control}>Pause</Text></Pressable>
    </View>
    <Pressable accessibilityRole="button" disabled={!steps.length} onPress={() => inspect(steps[0])}><Text style={styles.control}>{steps.length ? 'Walk me through it' : 'No moments to inspect'}</Text></Pressable>
    <View style={{ minHeight: steps.length ? 170 : 0 }}>
      {card && <InfoCard key={card.id} stageH={stageH} spot={{ side: 'top', offset: 0, cx: stageW / 2, width: stageW, from: 'below' }} text={card.summary} hint={preview ? 'Playback guide' : card.component === 'audio' ? 'Listen' : 'Look closer'} nav={{ step: Math.max(0, steps.findIndex(s => s.id === card.id)), count: steps.length, onBack: () => inspect(steps[Math.max(0, steps.findIndex(s => s.id === card.id) - 1)]), onNext: () => { const next = steps[steps.findIndex(s => s.id === card.id) + 1]; if (next) inspect(next); else { pending.current = undefined; setLeaving(true); setActive(undefined); } }, cue: 'done' }} leaving={leaving} onGone={() => { setCard(pending.current); setLeaving(false); }} />}
    </View>
    {steps.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={!item.tell} onPress={() => inspect(item)} style={styles.card}>
      <Text style={styles.text}>{item.summary}</Text>
      {item.tell && <Text style={styles.control}>{item.tell.t0.toFixed(1)}–{item.tell.t1.toFixed(1)}s · {item.component === 'audio' ? 'Listen' : 'Watch'}</Text>}
    </Pressable>)}
  </View>;
}
const useTint = themed(c => ({ text: { color: c.text, fontSize: 16, lineHeight: 24 }, control: { color: c.text, fontSize: 16, paddingVertical: 12 }, card: { padding: 18, backgroundColor: c.surface, borderRadius: 16, gap: 8 } }));
