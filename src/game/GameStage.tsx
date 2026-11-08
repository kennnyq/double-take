import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import type { Clip } from '@/data/clips';
import { IDLE, opsFor, planFor, type PlayerOp, type PlayerPlan } from '@/feed/playback';
import { playWeb } from '@/feed/playWeb';
import { POOL_SIZE, poolWindow } from '@/feed/pool';
import { fitFor } from '@/feed/tells';
import { useEased } from './motion';

interface Props {
  clips: readonly Clip[];
  /** The clip the pager is on, or heading to. */
  index: number;
  /** The pager's position in pages (fractional while sliding); cards sit at `(i − pos) · height`. */
  pos: Animated.Value;
  width: number;
  height: number;
  /** The clip on screen may play. */
  live: boolean;
  muted: boolean;
  /** The browser refused sound: the stage went muted. */
  onMutedByBrowser?: () => void;
}

/**
 * The round's clips, and nothing else: poster and video only. No caption,
 * author, verdict or tells, since a source title can say "AI". It never
 * mounts the feed's ClipItem, so nothing can leak in from there either.
 *
 * Three pooled players hold the clip that just left, the one on screen and
 * the next one, preloaded, so a slide never waits on the network. A card
 * shows its poster until its player holds the clip.
 */
export function GameStage({ clips, index, pos, width, height, live, muted, onMutedByBrowser }: Props) {
  const setup = (p: VideoPlayer) => {
    p.loop = true;
    p.muted = true;
  };
  const p0 = useVideoPlayer(null, setup);
  const p1 = useVideoPlayer(null, setup);
  const p2 = useVideoPlayer(null, setup);
  const players = useMemo(() => [p0, p1, p2], [p0, p1, p2]);

  const slots = useMemo(() => poolWindow(index, clips.length), [index, clips.length]);
  const [loaded, setLoaded] = useState<number[]>(() => Array(POOL_SIZE).fill(-1));
  const wanted = useRef<number[]>(Array(POOL_SIZE).fill(-1));
  const gen = useRef<number[]>(Array(POOL_SIZE).fill(0));

  const blocked = useRef(onMutedByBrowser);
  useEffect(() => {
    blocked.current = onMutedByBrowser;
  }, [onMutedByBrowser]);
  const apply = useCallback((player: VideoPlayer, plan: PlayerPlan) => {
    runOps(player, opsFor({ muted: player.muted, rate: player.playbackRate }, plan), plan, () => blocked.current?.());
  }, []);

  // Load each slot's clip; a newer load supersedes an older one.
  useEffect(() => {
    slots.forEach((idx, s) => {
      if (idx < 0 || wanted.current[s] === idx) return;
      wanted.current[s] = idx;
      const g = ++gen.current[s];
      setLoaded((l) => (l[s] === -1 ? l : l.map((v, i) => (i === s ? -1 : v))));
      apply(players[s], IDLE);
      players[s]
        .replaceAsync(clips[idx].video)
        .then(() => {
          if (gen.current[s] === g) setLoaded((l) => l.map((v, i) => (i === s ? idx : v)));
        })
        .catch(() => {});
    });
  }, [slots, clips, players, apply]);

  // Only the clip on screen plays; the others wait, muted, at their start.
  useEffect(() => {
    const state = { live, muted, paused: false, boost: false, slowmo: false };
    slots.forEach((idx, s) => {
      const on = idx === index && loaded[s] === idx;
      apply(players[s], planFor(on, state, 1));
      if (!on && loaded[s] === idx && idx > index && players[s].currentTime > 0) players[s].currentTime = 0;
    });
  }, [slots, loaded, index, live, muted, players, apply]);

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="none">
      {slots.map((idx, s) => {
        if (idx < 0) return null;
        const clip = clips[idx];
        const player = loaded[s] === idx ? players[s] : null;
        return (
          <Card
            // Keyed by slot so a player's view isn't remounted as it changes clips.
            key={s}
            clip={clip}
            player={player}
            width={width}
            height={height}
            idx={idx}
            pos={pos}
          />
        );
      })}
    </View>
  );
}

function Card({
  clip,
  player,
  width,
  height,
  idx,
  pos,
}: {
  clip: Clip;
  player: VideoPlayer | null;
  width: number;
  height: number;
  idx: number;
  pos: Animated.Value;
}) {
  const fit = fitFor(clip.aspect);
  const videoIn = useEased(player ? 1 : 0, 220);
  const translateY = useMemo(() => Animated.multiply(Animated.subtract(idx, pos), height), [idx, pos, height]);
  return (
    <Animated.View style={[styles.card, { width, height, transform: [{ translateY }] }]}>
      <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={fit === 'contain' ? 40 : 0} />
      {fit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
      {/* The poster stays underneath until the video has eased in over it: never a black card. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoIn }]}>
        {player && (
          <VideoView
            player={player}
            style={styles.video}
            contentFit={fit}
            nativeControls={false}
            playsInline
            allowsVideoFrameAnalysis={false}
          />
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** Applies `opsFor` calls to an expo-video player (as the feed does). */
function runOps(player: VideoPlayer, ops: PlayerOp[], plan: PlayerPlan, onBlocked: () => void): void {
  for (const op of ops) {
    if (op === 'pause') player.pause();
    else if (op === 'mute' || op === 'unmute') player.muted = op === 'mute';
    else if (op === 'rate') player.playbackRate = plan.rate;
    else if (Platform.OS !== 'web') player.play();
    else
      playWeb(player, () => {
        player.muted = true;
        onBlocked();
      });
  }
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#000' },
  card: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: '#000' },
  // Sized outright: a browser's <video> keeps its own size under left/right/top/bottom alone.
  video: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
});
