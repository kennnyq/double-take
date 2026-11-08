import { useEffect, useState } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { playWeb } from '@/feed/playWeb';
import { fitFor } from '@/feed/tells';
import { usePalette } from '@/ui/theme';
import { MISS_EXPLAINER } from './explainer';
import { useEased } from './motion';
import type { Guess } from './round';

interface Props {
  clip: Clip;
  guess: Guess;
  /** The misses either side, for stepping through them. */
  prev?: string;
  next?: string;
}

/** Same test as Home's for the desktop layout. */
function useDesktop() {
  const { width, height } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 760 && height >= 480;
}

/** Replays one missed clip with the explanation of what it really was. */
export function ReviewPlayer({ clip, guess, prev, next }: Props) {
  // TODO(feat/gesture-hint): call useBlockHints() from '@/onboarding/store' here once it lands on main.
  const desktop = useDesktop();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const c = usePalette();
  const stageH = desktop ? winH - 48 : winH;
  const stageW = desktop ? Math.min(winW - 48, Math.round((stageH * 9) / 16)) : winW;

  // Browsers allow sound only from a gesture; the replay starts muted there.
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const player = useVideoPlayer(clip.video, (p) => {
    p.loop = true;
    p.muted = Platform.OS === 'web';
  });
  const [ready, setReady] = useState(false);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setReady(true);
  });
  useEffect(() => applyMuted(player, muted), [player, muted]);
  useEffect(() => {
    if (!ready) return;
    if (Platform.OS === 'web') playWeb(player, () => setMuted(true));
    else player.play();
  }, [player, ready]);
  // The video eases in over its poster once it can play.
  const videoIn = useEased(ready ? 1 : 0);

  const fit = fitFor(clip.aspect);
  const Explainer = MISS_EXPLAINER;
  const go = (id: string) => router.replace({ pathname: '/game/review/[clipId]', params: { clipId: id } });

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.stage, { width: stageW, height: stageH, marginTop: desktop ? 24 : 0 }, desktop && styles.stageCard]}>
        <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={fit === 'contain' ? 40 : 0} />
        {fit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoIn }]}>
          <VideoView player={player} style={styles.video} contentFit={fit} nativeControls={false} playsInline allowsVideoFrameAnalysis={false} />
        </Animated.View>

        <View style={[styles.top, { paddingTop: (desktop ? 0 : insets.top) + 10 }]} pointerEvents="box-none">
          <RoundButton icon="chevron-back" label="Back to results" onPress={() => router.back()} />
          <View style={styles.spacer} />
          <RoundButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} />
          {prev && <RoundButton icon="arrow-back" label="Previous miss" onPress={() => go(prev)} />}
          {next && <RoundButton icon="arrow-forward" label="Next miss" onPress={() => go(next)} />}
        </View>

        <Explainer clip={clip} guess={guess} player={player} top={(desktop ? 0 : insets.top) + 56} bottom={desktop ? 0 : insets.bottom} />
      </View>
    </View>
  );
}

/** Outside the component: hooks' return values can't be written to in place. */
function applyMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

function RoundButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
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
  video: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pressed: { opacity: 0.6 },
});
