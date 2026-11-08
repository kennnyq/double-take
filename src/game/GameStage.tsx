import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import type { Clip } from '@/data/clips';
import { IDLE, opsFor, planFor, type PlayerOp, type PlayerPlan } from '@/feed/playback';
import { playWeb } from '@/feed/playWeb';
import { POOL_SIZE, poolWindow } from '@/feed/pool';
import { fitFor } from '@/feed/tells';
import type { DesignId } from './designs';
import { MarkStamp } from './MarkStamp';
import { lerp, useEased, type AnimNum } from './motion';

export type TransitionDesign = DesignId<'transition'>;

interface Props {
  clips: readonly Clip[];
  /** The clip the pager is on, or heading to. */
  index: number;
  /** The pager's position in pages (fractional while sliding); cards sit at `(i − pos) · height`. */
  pos: Animated.Value;
  /** How the clip on screen leaves: 0 up (a skip), 1 off to the side (a mark). */
  dir: Animated.Value;
  design: TransitionDesign;
  stamps?: readonly Stamp[];
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
export function GameStage({ clips, index, pos, dir, design, stamps, width, height, live, muted, onMutedByBrowser }: Props) {
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
            dir={dir}
            design={design}
            stamps={stamps?.filter((st) => st.idx === idx)}
          />
        );
      })}
    </View>
  );
}

/** An "AI" mark left on a clip: where the double tap landed, in the stage. */
export interface Stamp {
  key: number;
  idx: number;
  x: number;
  y: number;
}

/**
 * Where a card sits for its distance from the pager (`p = idx − pos`: 0 on
 * screen, −1 gone, +1 next), in each transition design. Every design moves
 * the leaving card fully off (or out of) the stage by p = −1, so a card
 * waiting there never shows.
 */
function cardMotion(design: TransitionDesign, p: AnimNum, dir: Animated.Value, w: number, h: number) {
  if (design === 'slide') return { transform: [{ translateY: Animated.multiply(p, h) }] };
  // How much of the leave is sideways: 0 for a skip (up), 1 for a mark (off to the side).
  const side = Animated.multiply(lerp(p, [-1, 0], [1, 0]), dir);
  if (design === 'stack') {
    return {
      transform: [
        // Leaving: up for a skip; off to the right, a little up, for a mark. Next: waits underneath.
        { translateY: Animated.add(lerp(p, [-1, 0], [-h * 1.05, 0]), lerp(side, [0, 1], [0, h * 0.8])) },
        { translateX: lerp(side, [0, 1], [0, w * 1.25]) },
        { rotate: lerp(side, [0, 1], ['0deg', '16deg']) },
        { scale: lerp(p, [0, 1], [1, 0.9]) },
      ],
    };
  }
  // Dissolve: the leaving card fades as it grows a little; the next settles from slightly larger.
  return {
    opacity: lerp(p, [-1, -0.05, 0], [0, 0.9, 1]),
    transform: [{ scale: lerp(p, [-1, 0, 1], [1.08, 1, 1.05]) }],
  };
}

function Card({
  clip,
  player,
  width,
  height,
  idx,
  pos,
  dir,
  design,
  stamps,
}: {
  clip: Clip;
  player: VideoPlayer | null;
  width: number;
  height: number;
  idx: number;
  pos: Animated.Value;
  dir: Animated.Value;
  design: TransitionDesign;
  stamps?: readonly Stamp[];
}) {
  const fit = fitFor(clip.aspect);
  const videoIn = useEased(player ? 1 : 0, 220);
  const p = useMemo(() => Animated.subtract(idx, pos), [idx, pos]);
  const motion = useMemo(() => cardMotion(design, p, dir, width, height), [design, p, dir, width, height]);
  // The card waiting underneath dims a little until it's on top (stack and dissolve).
  const shade = useMemo(() => lerp(p, [0, 1], [0, design === 'slide' ? 0 : 0.45]), [p, design]);
  return (
    <Animated.View style={[styles.card, { width, height, zIndex: 1000 - idx }, motion]}>
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
      <Animated.View style={[StyleSheet.absoluteFill, styles.shade, { opacity: shade }]} />
      {stamps?.map((st) => <MarkStamp key={st.key} x={st.x} y={st.y} />)}
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
  shade: { backgroundColor: '#000' },
});
