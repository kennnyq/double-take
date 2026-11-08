import { useEffect, useState } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { playWeb } from '@/feed/playWeb';
import { fitFor } from '@/feed/tells';
import { usePalette } from '@/ui/theme';
import { MISS_EXPLAINER } from '../explainer';
import { lerp, useEased, type AnimNum } from '../motion';
import type { Guess } from '../round';
import { entryLabel, type ResultEntry } from './ResultTile';

/** Outside the component: hooks' return values can't be written to in place. */
function applyMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

/**
 * A results clip opened full size: its poster at once (it's what the tile
 * showed), the video easing in over it once it plays, and the explanation
 * of what it really was. Lays itself out in whatever box the expand gives it.
 */
export function ClipView({ entry, open, top, bottom, onClose }: { entry: ResultEntry; open: AnimNum; top: number; bottom: number; onClose: () => void }) {
  const c = usePalette();
  const clip = entry.clip;
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
  const videoIn = useEased(ready ? 1 : 0);
  const fit = fitFor(clip.aspect);
  const Explainer = MISS_EXPLAINER;
  const guess: Guess = { clipId: entry.clipId, guess: entry.guess ?? 'real', truth: entry.truth, correct: entry.correct ?? false, at: 0 };
  // The chrome and the explanation follow once the clip has (nearly) opened.
  const chrome = lerp(open, [0.7, 1], [0, 1]);

  return (
    <View style={StyleSheet.absoluteFill} testID="clip-expanded">
      <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={fit === 'contain' ? 40 : 0} />
      {fit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoIn }]}>
        <VideoView player={player} style={styles.video} contentFit={fit} nativeControls={false} playsInline allowsVideoFrameAnalysis={false} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: chrome }]} pointerEvents="box-none">
        <View style={[styles.top, { paddingTop: top + 10 }]} pointerEvents="box-none">
          <RoundButton icon="close" label="Close" onPress={onClose} color={c.text} />
          <View style={styles.spacer} />
          <RoundButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} color={c.text} />
        </View>
        <Explainer clip={clip} guess={guess} label={entryLabel(entry)} player={player} top={top + 56} bottom={bottom} />
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
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pressed: { opacity: 0.6 },
});
