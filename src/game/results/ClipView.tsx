import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { REPLAY_RATE } from '@/annotations/walkthrough';
import { playWeb } from '@/feed/playWeb';
import { fitFor } from '@/feed/tells';
import { usePalette } from '@/ui/theme';
import { MISS_EXPLAINER, type ReplayControls } from '../explainer';
import { lerp, useEased, type AnimNum } from '../motion';
import { entryLabel, type ResultEntry } from './ResultTile';

/** Outside the component: hooks' return values can't be written to in place. */
function setPlayer(player: VideoPlayer, patch: { muted?: boolean; rate?: number; play?: boolean }) {
  if (patch.muted !== undefined) player.muted = patch.muted;
  if (patch.rate !== undefined && player.playbackRate !== patch.rate) player.playbackRate = patch.rate;
  if (patch.play === false) player.pause();
  else if (patch.play === true) {
    if (Platform.OS === 'web') playWeb(player, () => (player.muted = true));
    else player.play();
  }
}

interface Props {
  entry: ResultEntry;
  /** 0..1, the expand's progress: the buttons follow once it has (nearly) opened. */
  open: AnimNum;
  /** It has finished opening at its full size: the explanation starts. */
  settled: boolean;
  width: number;
  height: number;
  top: number;
  bottom: number;
  onClose: () => void;
}

/**
 * A results clip opened full size: its poster at once (it's what the tile
 * showed), the video easing in over it once it plays, and then the double
 * take's explanation of what it really was.
 */
export function ClipView({ entry, open, settled, width, height, top, bottom, onClose }: Props) {
  const c = usePalette();
  const clip = entry.clip;
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const [paused, setPaused] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const player = useVideoPlayer(clip.video, (p) => {
    p.loop = true;
    p.muted = Platform.OS === 'web';
  });
  const [ready, setReady] = useState(false);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setReady(true);
  });
  // The walkthrough mutes its slow loops and scrubs; the viewer's choice comes back after.
  const held = useRef({ slowmo: false, scrub: false });
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
    if (!held.current.slowmo && !held.current.scrub) setPlayer(player, { muted });
  }, [player, muted]);
  useEffect(() => {
    if (ready) setPlayer(player, { play: true });
  }, [player, ready]);

  const controls = useMemo<ReplayControls>(
    () => ({
      play: () => {
        setPaused(false);
        setPlayer(player, { play: true });
      },
      pause: () => {
        setPaused(true);
        setPlayer(player, { play: false });
      },
      slowmo: (on) => {
        held.current.slowmo = on;
        setPlayer(player, { rate: on ? REPLAY_RATE : 1, muted: on || mutedRef.current });
      },
      scrub: (on) => {
        held.current.scrub = on;
        if (on) setPlayer(player, { play: false, muted: true });
        else setPlayer(player, { muted: held.current.slowmo || mutedRef.current });
      },
      inspect: setInspecting,
    }),
    [player],
  );

  const videoIn = useEased(ready ? 1 : 0);
  // The walkthrough shows the whole frame, as the feed's does.
  const fit = inspecting ? 'contain' : fitFor(clip.aspect);
  const Explainer = MISS_EXPLAINER;
  const chrome = lerp(open, [0.7, 1], [0, 1]);
  // The replay's own buttons step aside while the walkthrough has its Close in that corner.
  const buttons = useEased(inspecting ? 0 : 1);

  return (
    <View style={StyleSheet.absoluteFill} testID="clip-expanded">
      <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={fit === 'contain' ? 40 : 0} />
      {fit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoIn }]}>
        <VideoView player={player} style={styles.video} contentFit={fit} nativeControls={false} playsInline allowsVideoFrameAnalysis={false} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: chrome }]} pointerEvents="box-none">
        {settled && (
          <Explainer
            clip={clip}
            truth={entry.truth}
            label={entryLabel(entry)}
            player={player}
            controls={controls}
            paused={paused}
            stageW={width}
            stageH={height}
            fit={fit}
            top={top + 10}
            bottom={bottom}
            ready={ready}
          />
        )}
        <Animated.View style={[styles.top, { paddingTop: top + 10, opacity: buttons }]} pointerEvents={inspecting ? 'none' : 'box-none'}>
          <RoundButton icon="close" label="Close" onPress={onClose} color={c.text} />
          <View style={styles.spacer} />
          {clip.sourceUrl ? <RoundButton icon="open-outline" label="Source" onPress={() => Linking.openURL(clip.sourceUrl!).catch(() => {})} color={c.text} /> : null}
          <RoundButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} color={c.text} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function RoundButton({ icon, label, onPress, color }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.button, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  video: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pressed: { opacity: 0.6 },
});
