import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formatCount, type Clip } from '@/data/clips';
import { baseReposts } from '@/social/clipRefs';
import { Avatar } from '@/ui/Avatar';
import type { FeedHandlers } from './Feed';
import { TellOverlay } from './TellOverlay';
import { fitFor } from './tells';

interface Props {
  clip: Clip;
  width: number;
  height: number;
  wide: boolean;
  player: VideoPlayer | null;
  isActive: boolean;
  paused: boolean;
  boost: boolean;
  liked: boolean;
  saved: boolean;
  reposted: boolean;
  sent: boolean;
  followed: boolean;
  /** How many comments you've added (shown on top of the clip's count). */
  myComments: number;
  progress: Animated.Value;
  /** Overlay opacity: fades rail/meta out while the page is shrunk above a sheet. */
  chrome: Animated.AnimatedInterpolation<number>;
  h: FeedHandlers;
}

const DOUBLE_TAP_MS = 280;

export const ClipItem = memo(function ClipItem(p: Props) {
  const { clip, width, height, wide, h } = p;
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; tilt: string }[]>([]);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const longPressed = useRef(false);
  // The tells walkthrough is open: show the whole frame and get the chrome out of the way.
  // Only the active clip can be inspecting (the overlay also closes itself when unmounted).
  const [inspectOn, setInspectOn] = useState(false);
  const inspecting = inspectOn && p.isActive;
  const onInspect = useCallback((on: boolean) => setInspectOn(on), []);

  // Tap toggles pause immediately (no waiting to rule out a double tap); a
  // second tap within DOUBLE_TAP_MS likes and always leaves the clip playing,
  // whether the first tap paused it or resumed it.
  const onPress = (e: GestureResponderEvent) => {
    if (!p.isActive) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const now = Date.now();
    const prev = lastTap.current;
    if (now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < 60) {
      h.play();
      h.like(clip);
      const tilt = `${Math.round(Math.random() * 30 - 15)}deg`;
      setBursts((b) => [...b, { id: now, x, y, tilt }]);
      lastTap.current = { t: 0, x: 0, y: 0 };
      return;
    }
    lastTap.current = { t: now, x, y };
    h.togglePause();
  };

  // Stage geometry: full-bleed on iPhone, a centred 9:16 card on iPad that
  // starts below the status bar so the clock doesn't sit on the card.
  const insets = useSafeAreaInsets();
  const cardTop = wide ? Math.max(14, insets.top + 8) : 0;
  const stageH = wide ? height - cardTop - 14 : height;
  const stageW = wide ? Math.round((stageH * 9) / 16) : width;
  // Landscape and square clips are shown whole over a blurred fill. So is any
  // clip during the walkthrough, so no highlighted region is cropped off screen.
  const fit = inspecting ? 'contain' : fitFor(clip.aspect);

  const stage = (
    <View style={[styles.stage, { width: stageW, height: stageH }, wide && styles.card]}>
      <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={fit === 'contain' ? 40 : 0} />
      {fit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
      {p.player && (
        <VideoView
          player={p.player}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          nativeControls={false}
          playsInline
          allowsVideoFrameAnalysis={false}
        />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.6)']}
        locations={[0, 0.5, 1]}
        style={styles.shade}
        pointerEvents="none"
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        onLongPress={() => {
          if (!p.isActive) return;
          longPressed.current = true;
          h.setBoost(true);
        }}
        delayLongPress={350}
        onPressOut={() => {
          if (longPressed.current) {
            longPressed.current = false;
            h.setBoost(false);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={p.paused ? 'Play' : 'Pause'}
      >
        {p.paused && !inspecting && (
          <View style={styles.pausedIcon} pointerEvents="none">
            <Ionicons name="play" size={38} color="#fff" style={{ marginLeft: 5 }} />
          </View>
        )}
        {bursts.map((b) => (
          <HeartBurst key={b.id} x={b.x} y={b.y} tilt={b.tilt} onDone={() => setBursts((all) => all.filter((o) => o.id !== b.id))} />
        ))}
      </Pressable>
      {clip.tellsUrl && p.isActive && (
        <TellOverlay
          url={clip.tellsUrl}
          player={p.player}
          stageW={stageW}
          stageH={stageH}
          aspect={clip.aspect ?? 9 / 16}
          fit={fit}
          top={wide ? 12 : insets.top + 54}
          paused={p.paused}
          onPause={h.pause}
          onPlay={h.play}
          onInspect={onInspect}
        />
      )}
      {p.boost && (
        <View style={styles.boostWrap} pointerEvents="none">
          <View style={styles.boost}>
            <Text style={styles.boostText}>2x</Text>
            <Ionicons name="play-forward" size={14} color="#fff" />
          </View>
        </View>
      )}

      {!inspecting && (
        <Animated.View style={[styles.meta, wide && styles.metaWide, { opacity: p.chrome }]} pointerEvents="box-none">
          <View style={styles.authorRow} pointerEvents="box-none">
            <Avatar name={clip.author} size={32} />
            <Text style={styles.handle} numberOfLines={1}>
              @{clip.author}
            </Text>
            {clip.verified && <Ionicons name="checkmark-circle" size={14} color="#e8e8e8" style={{ marginLeft: -4 }} />}
            <Pressable
              onPress={() => h.toggleFollow(clip.author)}
              style={({ pressed }) => [styles.subscribe, p.followed && styles.subscribed, pressed && styles.pressed]}
              hitSlop={8}
            >
              <Text style={[styles.subscribeText, p.followed && styles.subscribedText]}>
                {p.followed ? 'Subscribed' : 'Subscribe'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.caption} numberOfLines={1}>
            {clip.caption}
          </Text>
          <View style={styles.audioRow}>
            <Ionicons name="musical-notes" size={12} color="#ddd" />
            <Text style={styles.audioText} numberOfLines={1}>
              {clip.audio}
            </Text>
          </View>
        </Animated.View>
      )}

      {!wide && !inspecting && <Rail {...p} />}

      <View style={styles.progressTrack} pointerEvents="none">
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: stageW,
              transform: [
                { translateX: -stageW / 2 },
                { scaleX: p.isActive ? p.progress : 0 },
                { translateX: stageW / 2 },
              ],
            },
          ]}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.page, { width, height, paddingTop: wide ? cardTop - 14 : 0 }]}>
      {wide ? (
        <View style={styles.wideRow}>
          {stage}
          <View style={styles.wideRail}>
            <Rail {...p} />
          </View>
        </View>
      ) : (
        stage
      )}
    </View>
  );
});

function Rail(p: Props) {
  const { clip, h, wide } = p;
  return (
    <Animated.View style={[styles.rail, wide && styles.railWide, { opacity: p.chrome }]}>
      <RailButton
        icon={p.liked ? 'heart' : 'heart-outline'}
        color={p.liked ? '#ff3040' : '#fff'}
        label={formatCount(clip.likes + (p.liked ? 1 : 0))}
        a11y={p.liked ? 'Unlike' : 'Like'}
        onPress={() => h.toggleLike(clip)}
        pop={p.liked}
      />
      <RailButton
        icon="chatbox-ellipses-outline"
        label={formatCount(clip.comments + p.myComments)}
        a11y="Comments"
        onPress={() => h.openComments(clip)}
      />
      <RailButton
        icon="repeat"
        color={p.reposted ? REPOST_TINT : '#fff'}
        label={formatCount(baseReposts(clip) + (p.reposted ? 1 : 0))}
        a11y={p.reposted ? 'Undo repost' : 'Repost'}
        onPress={() => h.toggleRepost(clip)}
      />
      <RailButton
        icon="arrow-redo-outline"
        label={formatCount(clip.shares + (p.sent ? 1 : 0))}
        a11y="Share"
        onPress={() => h.openShare(clip)}
      />
      <RailButton
        icon={p.saved ? 'bookmark' : 'bookmark-outline'}
        label={p.saved ? 'Saved' : 'Save'}
        onPress={() => h.toggleSave(clip)}
      />
      <Image source={clip.poster} style={styles.soundThumb} />
    </Animated.View>
  );
}

const REPOST_TINT = '#3ddc84';

function RailButton(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** Spoken label when the visible label is a count. */
  a11y?: string;
  onPress: () => void;
  color?: string;
  pop?: boolean;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: to === 1 ? 12 : 0 }).start();
  return (
    <Pressable
      onPress={props.onPress}
      onPressIn={() => press(0.82)}
      onPressOut={() => press(1)}
      hitSlop={6}
      style={styles.railBtn}
      accessibilityRole="button"
      accessibilityLabel={props.a11y ? `${props.a11y}, ${props.label}` : props.label}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={props.icon} size={30} color={props.color ?? '#fff'} style={styles.iconShadow} />
      </Animated.View>
      <Text style={styles.railLabel}>{props.label}</Text>
    </Pressable>
  );
}

function HeartBurst({ x, y, tilt, onDone }: { x: number; y: number; tilt: string; onDone: () => void }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 850, useNativeDriver: true }).start(onDone);
    // Runs once per burst; onDone identity changes are irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scale = t.interpolate({ inputRange: [0, 0.15, 0.3, 0.7, 1], outputRange: [0.2, 1.15, 0.95, 1, 1.1] });
  const opacity = t.interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const lift = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, -80] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.burst,
        { left: x - 48, top: y - 58, opacity, transform: [{ translateY: lift }, { rotate: tilt }, { scale }] },
      ]}
    >
      <Ionicons name="heart" size={96} color="#ff3040" />
    </Animated.View>
  );
}

const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
};

const styles = StyleSheet.create({
  page: { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  stage: { overflow: 'hidden', backgroundColor: '#111' },
  card: { borderRadius: 14 },
  wideRow: { flexDirection: 'row', alignItems: 'flex-end' },
  wideRail: { marginLeft: 14, marginBottom: 18 },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
  pausedIcon: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -38,
    marginTop: -38,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boostWrap: { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'center' },
  boost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  boostText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  burst: { position: 'absolute' },
  meta: { position: 'absolute', left: 12, right: 80, bottom: 16, gap: 8 },
  metaWide: { right: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handle: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1, ...textShadow },
  subscribe: {
    marginLeft: 2,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#fff',
  },
  subscribed: { backgroundColor: 'rgba(255,255,255,0.22)' },
  subscribeText: { color: '#0f0f0f', fontSize: 14, fontWeight: '600' },
  subscribedText: { color: '#fff' },
  pressed: { transform: [{ scale: 0.95 }] },
  caption: { color: '#fff', fontSize: 14, lineHeight: 18, ...textShadow },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audioText: { color: '#ddd', fontSize: 12, flexShrink: 1, ...textShadow },
  rail: { position: 'absolute', right: 6, bottom: 16, width: 64, alignItems: 'center', gap: 16 },
  railWide: { position: 'relative', right: 0, bottom: 0 },
  railBtn: { alignItems: 'center', gap: 3 },
  iconShadow: { ...textShadow },
  railLabel: { color: '#fff', fontSize: 12, fontWeight: '500', ...textShadow },
  soundThumb: { width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: '#fff', marginTop: 4 },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  progressFill: { height: 2, backgroundColor: '#fff' },
});
