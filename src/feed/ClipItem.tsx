import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formatCount, type Clip, type Verdict } from '@/data/clips';
import { baseReposts } from '@/social/clipRefs';
import type { ClipCounts } from '@/social/reducer';
import { Avatar } from '@/ui/Avatar';
import { themed, usePalette } from '@/ui/theme';
import { useDevSettings } from '@/devtools/store';
import { createTapRecognizer, gestureAction, singleTapWaits } from '@/settings/gesture';
import { useAppSettings } from '@/settings/store';
import type { FeedHandlers } from './Feed';
import { TellOverlay, type TellOverlayHandle } from './TellOverlay';
import { fitFor } from './tells';
import { VerdictBadge } from './VerdictBadge';

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
  /** Other members' likes, reposts and comments (on top of the clip's own counts). */
  others?: ClipCounts;
  /** The verdict shown on the clip without a reveal (Auto label mode), or null. */
  label: Verdict | null;
  progress: Animated.Value;
  /** Overlay opacity: fades rail/meta out while the page is shrunk above a sheet. */
  chrome: Animated.AnimatedInterpolation<number>;
  h: FeedHandlers;
}

export const ClipItem = memo(function ClipItem(p: Props) {
  const { clip, width, height, wide, h } = p;
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; tilt: string }[]>([]);
  const [taps] = useState(createTapRecognizer);
  const longPressed = useRef(false);
  const tells = useRef<TellOverlayHandle>(null);
  const { revealGesture } = useAppSettings();
  const { holdMs } = useDevSettings();
  const hasTells = !!clip.tellsUrl && p.isActive;
  // The tells walkthrough is open: show the whole frame and get the chrome out of the way.
  // Only the active clip can be inspecting (the overlay also closes itself when unmounted).
  const [inspectOn, setInspectOn] = useState(false);
  const inspecting = inspectOn && p.isActive;
  const onInspect = useCallback((on: boolean) => setInspectOn(on), []);
  // A tap still waiting out the double-tap window must not act on the next clip.
  useEffect(() => {
    if (!p.isActive) taps.cancel();
    return () => taps.cancel();
  }, [p.isActive, taps]);

  // A tap plays/pauses; a second tap within DOUBLE_TAP_MS likes or opens the
  // double take (per the viewer's gesture setting). When it would open the
  // double take, the first tap waits out the window, so opening never pauses
  // the clip first; otherwise the tap acts at once and a like resumes playback.
  const onPress = (e: GestureResponderEvent) => {
    if (!p.isActive) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const t = Date.now();
    taps.tap(
      { t, x, y },
      {
        wait: singleTapWaits(revealGesture, hasTells),
        onSingle: () => h.togglePause(),
        onDouble: (firstRan) => {
          if (gestureAction('doubleTap', revealGesture, { hasTells, canBoost: true }) === 'reveal') {
            tells.current?.open(); // plays the clip itself
            return;
          }
          // Like, and never leave the first tap's pause behind.
          if (firstRan) h.play();
          // A guest's like opens sign-in instead: no heart.
          if (!h.like(clip)) return;
          const tilt = `${Math.round(Math.random() * 30 - 15)}deg`;
          setBursts((b) => [...b, { id: t, x, y, tilt }]);
        },
      },
    );
  };

  // Holding plays at 2x until released, or opens the double take (which stays
  // open after release: it's a tap-through walkthrough).
  const onLongPress = () => {
    if (!p.isActive) return;
    taps.cancel();
    const action = gestureAction('hold', revealGesture, { hasTells, canBoost: true });
    if (action === 'reveal') {
      tells.current?.open();
    } else if (action === 'boost') {
      longPressed.current = true;
      h.setBoost(true);
    }
  };

  // The Double take button opens it whatever the gesture setting (and closes it on iPad, where the rail stays).
  const toggleReveal = () => (inspecting ? tells.current?.close() : tells.current?.open());
  const onReveal = clip.tellsUrl ? toggleReveal : undefined;

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
        onLongPress={onLongPress}
        delayLongPress={holdMs}
        onPressOut={() => {
          if (longPressed.current) {
            longPressed.current = false;
            h.setBoost(false);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={p.paused ? 'Play' : 'Pause'}
        accessibilityActions={hasTells ? [{ name: 'activate' }, { name: 'magicTap', label: 'Double take' }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'magicTap') tells.current?.open();
          else h.togglePause();
        }}
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
          ref={tells}
          variants={clip.tellsVariants ?? [{ name: 'main', url: clip.tellsUrl }]}
          player={p.player}
          stageW={stageW}
          stageH={stageH}
          aspect={clip.aspect ?? 9 / 16}
          fit={fit}
          top={wide ? 12 : insets.top + 54}
          paused={p.paused}
          onPause={h.pause}
          onPlay={h.play}
          onSlowmo={h.setSlowmo}
          onInspect={onInspect}
        />
      )}
      {/* The reveal shows the verdict along with the reasoning, in every feed mode. */}
      {inspecting && clip.verdict && (
        <View style={[styles.revealVerdict, { top: (wide ? 12 : insets.top + 54) + 3 }]} pointerEvents="none">
          <VerdictBadge verdict={clip.verdict} />
        </View>
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
          {p.label && (
            <View style={styles.labelRow} pointerEvents="none">
              <VerdictBadge verdict={p.label} />
            </View>
          )}
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

      {!wide && !inspecting && <Rail {...p} onReveal={onReveal} revealing={inspecting} />}

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
            <Rail {...p} onReveal={onReveal} revealing={inspecting} />
          </View>
        </View>
      ) : (
        stage
      )}
    </View>
  );
});

/**
 * The clip's actions. `onReveal` is set for clips with tells: its Double take
 * button sits above the like and opens the walkthrough whatever the gesture setting.
 */
function Rail(p: Props & { onReveal?: () => void; revealing: boolean }) {
  const { clip, h, wide } = p;
  const c = usePalette();
  return (
    <Animated.View style={[styles.rail, wide && styles.railWide, { opacity: p.chrome }]}>
      {p.onReveal && (
        <RailButton
          icon={<DoubleTakeIcon on={p.revealing} />}
          label="Double take"
          a11y={p.revealing ? 'Close the double take' : 'Double take: see why this clip may be AI'}
          hideLabelFromA11y
          compactLabel
          onPress={p.onReveal}
        />
      )}
      <RailButton
        icon={p.liked ? 'heart' : 'heart-outline'}
        color={p.liked ? c.like : '#fff'}
        label={formatCount(clip.likes + (p.others?.likes ?? 0) + (p.liked ? 1 : 0))}
        a11y={p.liked ? 'Unlike' : 'Like'}
        onPress={() => h.toggleLike(clip)}
        pop={p.liked}
      />
      <RailButton
        icon="chatbox-ellipses-outline"
        label={formatCount(clip.comments + (p.others?.comments ?? 0) + p.myComments)}
        a11y="Comments"
        onPress={() => h.openComments(clip)}
      />
      <RailButton
        icon="repeat"
        color={p.reposted ? c.repost : '#fff'}
        label={formatCount(baseReposts(clip) + (p.others?.reposts ?? 0) + (p.reposted ? 1 : 0))}
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

/**
 * "Look again": an eye in a viewfinder, the double take's mark. While the
 * walkthrough is open it sits on a filled disc, so "on" reads by shape too,
 * not only by colour.
 */
function DoubleTakeIcon({ on }: { on: boolean }) {
  const c = usePalette();
  const tint = useTint();
  const color = on ? c.onTell : '#fff';
  return (
    <View style={[styles.doubleTakeIcon, on && tint.doubleTakeOn]}>
      <Ionicons name="scan-outline" size={30} color={color} style={!on && styles.iconShadow} />
      <Ionicons name="eye" size={14} color={color} style={styles.doubleTakeEye} />
    </View>
  );
}

const useTint = themed((c) => ({
  // A ring of the same colour grows the disc past the icon without moving the rail.
  doubleTakeOn: { borderRadius: 15, backgroundColor: c.tell, boxShadow: `0 0 0 5px ${c.tell}` },
}));

function RailButton(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'] | React.ReactElement;
  label: string;
  /** Spoken label when the visible label is a count. */
  a11y?: string;
  /** Speak only `a11y` (the label repeats it). */
  hideLabelFromA11y?: boolean;
  /** A word label rather than a count: smaller, so it stays on one line. */
  compactLabel?: boolean;
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
      accessibilityLabel={
        props.a11y ? (props.hideLabelFromA11y ? props.a11y : `${props.a11y}, ${props.label}`) : props.label
      }
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {typeof props.icon === 'string' ? (
          <Ionicons name={props.icon} size={30} color={props.color ?? '#fff'} style={styles.iconShadow} />
        ) : (
          props.icon
        )}
      </Animated.View>
      <Text style={[styles.railLabel, props.compactLabel && styles.railLabelCompact]} numberOfLines={1}>
        {props.label}
      </Text>
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
  labelRow: { flexDirection: 'row' },
  revealVerdict: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
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
  doubleTakeIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  doubleTakeEye: { position: 'absolute' },
  railLabel: { color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'center', ...textShadow },
  railLabelCompact: { fontSize: 11, letterSpacing: -0.2 },
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
