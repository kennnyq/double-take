import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Reanimated, { interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { VideoView, type VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formatCount, type Clip, type Verdict } from '@/data/clips';
import { baseReposts } from '@/social/clipRefs';
import type { ClipCounts } from '@/social/reducer';
import { Avatar } from '@/ui/Avatar';
import { usePalette } from '@/ui/theme';
import { useDevSettings } from '@/devtools/store';
import { createTapRecognizer, gestureAction, revealsWith, singleTapWaits } from '@/settings/gesture';
import { useAppSettings } from '@/settings/store';
import { GestureHint } from '@/onboarding/GestureHint';
import type { FeedHandlers } from './Feed';
import { BlurredStill, CornerCaps, useCheapClip } from './InspectStage';
import { Scrubber } from './Scrubber';
import { ownLayer } from './layer';
import { paddingPx, spotlightStrength } from './spotlight';
import { useSpotlightMotion } from './spotlightMotion';
import { TellOverlay, type SpotState, type TellOverlayHandle } from './TellOverlay';
import { useFadeProgress, useModeProgress } from './motion';
import { displayCornerRadius, inspectInset } from './shrink';
import { fitFor } from './tells';
import { VerdictBadge } from './VerdictBadge';
import type { ClipPolicy } from './mode';

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
  /** A feed mode's say over this page (see `mode.ts`); none in the normal feed. */
  policy?: ClipPolicy;
}

/** A revisited clip (see `ClipPolicy.autoReveal`) opens its double take this long after it settles. */
const AUTO_REVEAL_MS = 450;

export const ClipItem = memo(function ClipItem(p: Props) {
  const { clip, width, height, wide, h } = p;
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; tilt: string }[]>([]);
  const [taps] = useState(createTapRecognizer);
  const longPressed = useRef(false);
  const tells = useRef<TellOverlayHandle>(null);
  const { revealGesture } = useAppSettings();
  const { holdMs, spotlightEffect, spotlightShape, spotlightPadding, spotlightStrength: strength } = useDevSettings();
  const hasTells = !!clip.tellsUrl && p.isActive;
  // A feed mode can take the double take's gesture (the game marks AI with it).
  const revealTo = p.isActive ? p.policy?.onReveal : undefined;
  const canReveal = hasTells || !!revealTo;
  const pressAt = useRef({ x: NaN, y: NaN });
  const reveal = (x: number, y: number) => (revealTo ? revealTo(x, y) : tells.current?.open());
  // The tells walkthrough is open: show the whole frame and get the chrome out of the way.
  // Only the active clip can be inspecting (the overlay also closes itself when unmounted).
  const [inspectOn, setInspectOn] = useState(false);
  const inspecting = inspectOn && p.isActive;
  const setFeedInspecting = h.setInspecting;
  const onInspect = useCallback(
    (on: boolean) => {
      setInspectOn(on);
      setFeedInspecting(on);
    },
    [setFeedInspecting],
  );
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
    const policy = p.policy;
    taps.tap(
      { t, x, y },
      {
        wait: singleTapWaits(revealGesture, canReveal),
        onSingle: () => !policy?.noTapPause && h.togglePause(),
        onDouble: (firstRan) => {
          if (gestureAction('doubleTap', revealGesture, { hasTells: canReveal, canBoost: true }) === 'reveal') {
            reveal(x, y); // the double take plays the clip itself
            return;
          }
          // Locked controls (a game): no like either.
          if (policy?.lockControls) return;
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
    const action = gestureAction('hold', revealGesture, { hasTells: canReveal, canBoost: !p.policy?.noHold });
    if (action === 'reveal') {
      reveal(pressAt.current.x, pressAt.current.y);
    } else if (action === 'boost') {
      longPressed.current = true;
      h.setBoost(true);
    }
  };

  // A press where a hold would reveal: the mode can draw it filling (and its release).
  const holding = useRef(false);
  const onPressIn = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    pressAt.current = { x, y };
    if (!p.isActive || !p.policy?.onPress || !revealsWith('hold', revealGesture)) return;
    holding.current = true;
    p.policy.onPress({ phase: 'start', x, y, holdMs });
  };
  const endPress = () => {
    if (!holding.current) return;
    holding.current = false;
    p.policy?.onPress?.({ phase: 'end', x: pressAt.current.x, y: pressAt.current.y, holdMs });
  };

  // A clip revisited to learn from (the game) opens its double take by itself once it settles.
  const autoReveal = p.isActive && !!p.policy?.autoReveal && !!clip.tellsUrl;
  useEffect(() => {
    if (!autoReveal) return;
    const t = setTimeout(() => tells.current?.open(), AUTO_REVEAL_MS);
    return () => clearTimeout(t);
  }, [autoReveal]);

  // The Double take button opens it whatever the gesture setting (and closes it on iPad, where the rail stays).
  const toggleReveal = () => (inspecting ? tells.current?.close() : tells.current?.open());
  const onReveal = clip.tellsUrl ? toggleReveal : undefined;

  // Stage geometry: full-bleed on iPhone, a centred 9:16 card on iPad that
  // starts below the status bar so the clock doesn't sit on the card.
  const insets = useSafeAreaInsets();
  const cardTop = wide ? Math.max(14, insets.top + 8) : 0;
  const stageH = wide ? height - cardTop - 14 : height;
  const stageW = wide ? Math.round((stageH * 9) / 16) : width;
  // The walkthrough's Close button row: under the status bar once the video has inset.
  // (The inset card already sits below the status bar and Dynamic Island.)
  const walkthroughTop = wide ? 12 : 14;
  // Landscape and square clips are shown whole over a blurred fill. So is any
  // clip during the walkthrough, so no highlighted region is cropped off screen.
  const baseFit = fitFor(clip.aspect);
  const fit = inspecting ? 'contain' : baseFit;
  // A portrait clip of known shape is drawn contained and scaled up to fill the
  // stage, so the walkthrough can zoom it out to the whole frame continuously
  // (rather than cutting from cover to contain).
  const zoomOut = baseFit === 'cover' && clip.aspect !== undefined;
  const coverScale = zoomOut ? Math.max(clip.aspect! / (stageW / stageH), stageW / stageH / clip.aspect!) : 1;
  const videoFit = zoomOut ? 'contain' : baseFit;

  // The double take: the video insets like a card, its corners concentric with
  // the display's, and the clip's chrome fades out. All of it springs back on exit.
  const mode = useModeProgress(inspecting);
  const chromeOut = useFadeProgress(!inspecting, inspecting ? 180 : 320);
  const screen = useWindowDimensions();
  const inset = inspectInset(stageW, stageH, displayCornerRadius(screen.width, screen.height, Platform.OS), insets.top);
  // Browsers round the inset stage itself; the apps cap its corners instead
  // (see CornerCaps: a rounded clip over video costs iOS an offscreen pass per frame).
  const roundWithCaps = Platform.OS !== 'web' && !wide;
  const stageMotion = useAnimatedStyle(() =>
    wide
      ? { borderRadius: 14 }
      : {
          ...(roundWithCaps ? {} : { borderRadius: interpolate(mode.value, [0, 1], [0, inset.radius]) }),
          transform: [
            { translateY: interpolate(mode.value, [0, 1], [0, inset.dy]) },
            { scale: interpolate(mode.value, [0, 1], [1, inset.scale]) },
          ],
        },
  );

  // The spotlight's motion lives here, so the apps' cheap blur can clip the
  // live video to the area (the overlay draws the dimming with the same values).
  const [spot, setSpot] = useState<SpotState>({ area: null, stillAt: null });
  const motion = useSpotlightMotion(spot.area, spotlightShape, paddingPx(spotlightPadding));
  const cheap = Platform.OS !== 'web' && spotlightEffect === 'cheapBlur' && inspecting;
  const cheapOn = useFadeProgress(cheap, 1);
  const cheapClip = useCheapClip(motion, cheapOn, stageW, stageH);
  const zoomMotion = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(mode.value, [0, 1], [coverScale, 1]) }],
  }));
  // Landscape clips' blurred fill fades out in the walkthrough: plain dark bands there, no blur.
  const fillMotion = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, mode.value)) }));
  const chromeMotion = useAnimatedStyle(() => ({ opacity: chromeOut.value }));
  const verdictMotion = useAnimatedStyle(() => ({ opacity: 1 - chromeOut.value }));
  // The clip's corner radius right now, in stage px: the progress bar's ends sit that far in.
  const cornerRadius = useDerivedValue(() => (wide ? 14 : interpolate(mode.value, [0, 1], [0, inset.radius])));

  const stage = (
    <Reanimated.View style={[styles.stage, ownLayer, { width: stageW, height: stageH }, stageMotion]}>
      {/* Portrait clips zoom out to dark bands; landscape ones show a blurred fill outside the walkthrough. */}
      {baseFit === 'contain' ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, p.isActive && ownLayer, p.isActive && fillMotion]} pointerEvents="none">
          <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={40} />
        </Reanimated.View>
      ) : (
        !zoomOut && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {cheap && p.player && spot.stillAt !== null && (
        <BlurredStill player={p.player} at={spot.stillAt} blur={spotlightStrength(strength, true).stillBlur} m={motion} />
      )}
      {/* Always the same three wrappers, so the video never remounts; they're identity unless the cheap blur clips it. */}
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.clip, cheapClip.outer]} pointerEvents="none">
        <Reanimated.View style={[StyleSheet.absoluteFill, cheapClip.inner]}>
          <Reanimated.View style={[StyleSheet.absoluteFill, zoomOut && ownLayer, zoomOut && zoomMotion]}>
            {videoFit === 'contain' && <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="contain" />}
            {p.player && (
              <VideoView
                player={p.player}
                style={StyleSheet.absoluteFill}
                contentFit={videoFit}
                nativeControls={false}
                playsInline
                allowsVideoFrameAnalysis={false}
              />
            )}
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
      <Reanimated.View style={[styles.shade, ownLayer, chromeMotion]} pointerEvents="none">
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.6)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Reanimated.View>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={holdMs}
        onPressIn={onPressIn}
        onPressOut={() => {
          endPress();
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
          <View style={styles.pausedIcon} pointerEvents="none" testID="paused-icon">
            <Ionicons name="play" size={38} color="#fff" style={{ marginLeft: 5 }} />
          </View>
        )}
        {bursts.map((b) => (
          <HeartBurst key={b.id} x={b.x} y={b.y} tilt={b.tilt} onDone={() => setBursts((all) => all.filter((o) => o.id !== b.id))} />
        ))}
      </Pressable>
      <GestureHint clipId={clip.id} active={p.isActive} hasTells={!!clip.tellsUrl} doubleTakeOpen={inspecting} blocked={p.paused} layout="phone" opacity={p.chrome} />
      {clip.tellsUrl && p.isActive && (
        <TellOverlay
          ref={tells}
          variants={clip.tellsVariants ?? [{ name: 'main', url: clip.tellsUrl }]}
          player={p.player}
          stageW={stageW}
          stageH={stageH}
          aspect={clip.aspect ?? 9 / 16}
          fit={fit}
          top={walkthroughTop}
          paused={p.paused}
          onPause={h.pause}
          onPlay={h.play}
          onSlowmo={h.setSlowmo}
          onScrub={h.setScrub}
          onInspect={onInspect}
          motion={motion}
          onSpot={setSpot}
          onScrubPlan={h.followScrub}
        />
      )}
      {/* The reveal shows the verdict along with the reasoning, in every feed mode. */}
      {p.isActive && clip.verdict && (
        <Reanimated.View style={[styles.revealVerdict, ownLayer, { top: walkthroughTop + 3 }, verdictMotion]} pointerEvents="none">
          <VerdictBadge verdict={clip.verdict} />
        </Reanimated.View>
      )}
      {p.boost && (
        <View style={styles.boostWrap} pointerEvents="none">
          <View style={styles.boost}>
            <Text style={styles.boostText}>2x</Text>
            <Ionicons name="play-forward" size={14} color="#fff" />
          </View>
        </View>
      )}

      <Animated.View
        style={[styles.meta, wide && styles.metaWide, { opacity: p.chrome }]}
        pointerEvents={inspecting ? 'none' : 'box-none'}
      >
        <Reanimated.View style={[styles.metaInner, ownLayer, chromeMotion]} pointerEvents={inspecting ? 'none' : 'box-none'}>
          {p.label && (
            <View style={styles.labelRow} pointerEvents="none">
              <VerdictBadge verdict={p.label} />
            </View>
          )}
          <View style={styles.authorRow} pointerEvents={inspecting ? 'none' : 'box-none'}>
            <Avatar name={clip.author} size={32} />
            <Text style={styles.handle} numberOfLines={1}>
              @{clip.author}
            </Text>
            {clip.verified && <Ionicons name="checkmark-circle" size={14} color="#e8e8e8" style={{ marginLeft: -4 }} />}
            <Pressable
              onPress={() => h.toggleFollow(clip.author)}
              disabled={!!p.policy?.lockControls}
              style={({ pressed }) => [styles.subscribe, p.followed && styles.subscribed, pressed && styles.pressed, p.policy?.lockControls && styles.locked]}
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
        </Reanimated.View>
      </Animated.View>

      {!wide && (
        <Reanimated.View style={[styles.railWrap, ownLayer, chromeMotion]} pointerEvents={inspecting || p.policy?.lockControls ? 'none' : 'box-none'}>
          <View style={[StyleSheet.absoluteFill, p.policy?.lockControls && styles.locked]} pointerEvents={inspecting || p.policy?.lockControls ? 'none' : 'box-none'}>
            <Rail {...p} onReveal={onReveal} revealing={inspecting} />
          </View>
        </Reanimated.View>
      )}

      {/* The progress bar stays as it is during a double take, out of reach (the walkthrough owns the taps). */}
      <Reanimated.View style={[styles.scrubWrap, ownLayer]} pointerEvents={inspecting || p.policy?.lockControls ? 'none' : 'box-none'}>
        <View style={[StyleSheet.absoluteFill, p.policy?.lockControls && styles.locked]} pointerEvents={inspecting || p.policy?.lockControls ? 'none' : 'box-none'}>
          <Scrubber
            player={p.isActive ? p.player : null}
            progress={p.isActive ? p.progress : IDLE_PROGRESS}
            width={stageW}
            enabled={p.isActive && !inspecting && !p.policy?.lockControls}
            onHold={h.setScrub}
            onDrag={h.setBarDrag}
            onFollow={h.followScrub}
            endInset={cornerRadius}
          />
        </View>
      </Reanimated.View>
      {roundWithCaps && p.isActive && <CornerCaps radius={inset.radius} progress={mode} />}
    </Reanimated.View>
  );

  return (
    <View style={[styles.page, { width, height, paddingTop: wide ? cardTop - 14 : 0 }]}>
      {wide ? (
        <View style={styles.wideRow}>
          {stage}
          <View style={[styles.wideRail, p.policy?.lockControls && styles.locked]} pointerEvents={p.policy?.lockControls ? 'none' : 'box-none'}>
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

// Same Ionicons family and 30px size as the other rail actions. Crossfade
// outline/filled glyphs so opening and closing can retarget without a cut.
function DoubleTakeIcon({ on }: { on: boolean }) {
  const c = usePalette();
  const active = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    active.set(withTiming(on ? 1 : 0, { duration: 220 }));
  }, [on, active]);
  const outline = useAnimatedStyle(() => ({ opacity: 1 - active.value }));
  const filled = useAnimatedStyle(() => ({ opacity: active.value }));
  return (
    <View style={styles.doubleTakeIcon}>
      <Reanimated.View style={[StyleSheet.absoluteFill, ownLayer, outline]}>
        <Ionicons name="eye-outline" size={30} color="#fff" style={styles.iconShadow} />
      </Reanimated.View>
      <Reanimated.View style={[StyleSheet.absoluteFill, ownLayer, filled]}>
        <Ionicons name="eye" size={30} color={c.tell} style={styles.iconShadow} />
      </Reanimated.View>
    </View>
  );
}

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

/** The bar of a clip that isn't playing: empty. */
const IDLE_PROGRESS = new Animated.Value(0);

const styles = StyleSheet.create({
  page: { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  // A control a feed mode shows but locks (e.g. in the timed round).
  locked: { opacity: 0.38 },
  stage: { overflow: 'hidden', backgroundColor: '#000' },
  clip: { overflow: 'hidden' },
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
  meta: { position: 'absolute', left: 12, right: 80, bottom: 16 },
  metaInner: { gap: 8 },
  railWrap: { ...StyleSheet.absoluteFill },
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
  railLabel: { color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'center', ...textShadow },
  railLabelCompact: { fontSize: 11, letterSpacing: -0.2 },
  soundThumb: { width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: '#fff', marginTop: 4 },
  scrubWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28 },
});
