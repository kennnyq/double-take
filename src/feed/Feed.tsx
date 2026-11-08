import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  FlatList,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { REPLAY_RATE } from '@/annotations/walkthrough';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { makeClips, type Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { receiveHandoff } from '@/landing/handoff';
import { useSocialActions } from '@/social/actions';
import { clipKey } from '@/social/clipRefs';
import { useAppNav } from '@/social/nav';
import { useSocial } from '@/social/store';
import { appSettings, useAppSettings } from '@/settings/store';
import { autoLabel, clipsForMode, isAppend, keepPosition, modeFilter, shownIndexOf } from './feedMode';
import { POOL_SIZE, indexFromOffset, isOnPage, isWideLayout, poolWindow } from './pool';
import { IDLE, guardOps, opsFor, planFor, type PlaybackState, type PlayerOp, type PlayerPlan } from './playback';
import { describeAudio } from './audioDebug';
import { shrinkGeometry } from './shrink';
import { playWeb } from './playWeb';
import { ClipItem } from './ClipItem';
import { TopBar } from './TopBar';
import { FeedEmpty } from './VerdictBadge';

interface FeedProps {
  focused: boolean;
  /** A comments/share sheet is up (or animating): lock scrolling, round the shrunk page. */
  sheetOpen: boolean;
  /** 0..1 sheet position, driven on the native thread by the sheet. Shrinks the active page. */
  sheetProgress: Animated.Value;
  /** Open on this clip instead of the first (web: the landing's launch). Read once, at mount. */
  startAt?: number;
  ref?: React.Ref<FeedHandle>;
}

export interface FeedHandle {
  /** Land on an item index instantly (no animated scroll), loading more clips first if needed. */
  jumpTo: (index: number) => void;
}

/**
 * Shorts-style vertical pager.
 *
 * Scrolling is UIScrollView paging (`pagingEnabled`), so drag, flick physics,
 * rubber-banding and "one item per swipe" are Apple's own. We only observe
 * where it settles.
 *
 * Playback uses a pool of three players (active item + neighbours). A player is
 * recycled for the item entering the window, so the next clip is already
 * buffered when you swipe and memory stays flat no matter how far you scroll.
 */
export function Feed({ focused, sheetOpen, sheetProgress, startAt, ref }: FeedProps) {
  // Empty until the first page arrives (remote clips, then placeholders).
  const [all, setAll] = useState<Clip[]>([]);
  // The feed mode (Settings) may keep only AI or only real clips. A filtered
  // feed ends: placeholders have no verdict, so it never grows.
  const { feedMode } = useAppSettings();
  const filter = modeFilter(feedMode);
  const clips = useMemo(() => clipsForMode(all, feedMode), [all, feedMode]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(startAt ?? 0);
  // Browsers require a user gesture before playing video with sound.
  const [muted, setMuted] = useState(Platform.OS === 'web');
  // Web: the landing's launch hands over its sound once this feed has taken over.
  useEffect(() => receiveHandoff((h) => setMuted(h.muted)), []);
  const [paused, setPaused] = useState(false);
  const [boost, setBoost] = useState(false);
  // The tells walkthrough loops a stretch in slow motion, muted.
  const [slowmo, setSlowmo] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const listRef = useRef<FlatList<Clip>>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const wide = isWideLayout(size.w, size.h);

  // ---- players -----------------------------------------------------------
  const setup = (p: VideoPlayer) => {
    playersCreated++;
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  };
  const p0 = useVideoPlayer(null, setup);
  const p1 = useVideoPlayer(null, setup);
  const p2 = useVideoPlayer(null, setup);
  const players = useMemo(() => [p0, p1, p2], [p0, p1, p2]);

  // Only what differs is written (see `opsFor`): on iOS, setting the rate
  // starts a player, and every play or mute change reconfigures the audio
  // session, so rewriting all three players on each change (a mute press, a
  // neighbour finishing loading) started and stopped paused ones mid-playback.
  //
  // Web: browsers refuse to start a video with sound outside a user gesture
  // (iOS Safari always does for a <video> it hasn't played from a tap). Rather
  // than leave the clip stopped and silent under an unmuted icon, fall back to
  // muted playback; the sound button then unmutes it inside its tap.
  const applyPlan = useCallback((player: VideoPlayer, plan: PlayerPlan) => {
    runOps(player, opsFor({ muted: player.muted, rate: player.playbackRate }, plan), plan, () => setMuted(true));
  }, []);

  const slotIndex = useMemo(() => poolWindow(active, clips.length), [active, clips.length]);
  // Which item each player has finished loading (-1 while loading). Views only
  // attach a player once it holds their clip, so a recycled player never
  // flashes the previous clip's frame.
  const [loaded, setLoaded] = useState<number[]>(() => Array(POOL_SIZE).fill(-1));
  const loadGen = useRef<number[]>(Array(POOL_SIZE).fill(0));
  const wanted = useRef<number[]>(Array(POOL_SIZE).fill(-1));

  // The feed mode changed what's shown: stay on the same clip (or the nearest
  // one after it) and reload the players, since every index now means another
  // clip. Runs before the loader below, so it sees the reset.
  const shownBefore = useRef(clips);
  useEffect(() => {
    const prev = shownBefore.current;
    shownBefore.current = clips;
    if (isAppend(prev, clips)) return;
    const i = keepPosition(prev, clips, activeRef.current);
    wanted.current = Array(POOL_SIZE).fill(-1);
    setLoaded(Array(POOL_SIZE).fill(-1));
    activeRef.current = i;
    setActive(i);
    setPaused(false);
    setBoost(false);
    if (size.h) listRef.current?.scrollToOffset({ offset: i * size.h, animated: false });
  }, [clips, size.h]);

  useEffect(() => {
    slotIndex.forEach((idx, s) => {
      if (idx < 0 || wanted.current[s] === idx) return;
      wanted.current[s] = idx;
      const gen = ++loadGen.current[s];
      setLoaded((l) => (l[s] === -1 ? l : l.map((v, i) => (i === s ? -1 : v))));
      const player = players[s];
      applyPlan(player, IDLE);
      player
        .replaceAsync(clips[idx].video)
        .then(() => {
          if (loadGen.current[s] !== gen) return; // superseded by a newer load
          setLoaded((l) => l.map((v, i) => (i === s ? idx : v)));
        })
        .catch(() => {});
    });
  }, [slotIndex, players, clips, applyPlan]);

  // What the players were last told, for handlers and native events (read
  // through refs so the handlers stay stable: the walkthrough treats a new
  // `setSlowmo` as leaving the clip). Updated by the effect below as it
  // applies them, so an event never sees a newer pool with older orders.
  const playback = useRef<PlaybackState>({ live: false, muted, paused, boost, slowmo });
  const pool = useRef({ slotIndex, active, loaded });

  // Apply play/pause/mute/rate to every player whenever anything relevant changes.
  useEffect(() => {
    const state = { live: focused && appActive, muted, paused, boost, slowmo };
    playback.current = state;
    pool.current = { slotIndex, active, loaded };
    slotIndex.forEach((idx, s) => {
      applyPlan(players[s], planFor(idx === active && loaded[s] === idx, state, REPLAY_RATE));
    });
    // Rewind clips we left once they're off screen, so revisits start over.
    const t = setTimeout(() => {
      slotIndex.forEach((idx, s) => {
        if (idx !== activeRef.current && loaded[s] === idx && players[s].currentTime > 0) {
          players[s].currentTime = 0;
        }
      });
    }, 450);
    return () => clearTimeout(t);
  }, [slotIndex, loaded, active, focused, appActive, muted, paused, boost, slowmo, players, applyPlan]);

  useEffect(() => {
    let live = true;
    loadInitialClips().then((c) => {
      if (!live) return;
      // A filtered feed opens on the landing's clip, or the next one it shows.
      const mode = appSettings.getSnapshot().feedMode;
      if (startAt !== undefined && modeFilter(mode)) {
        const i = shownIndexOf(clipsForMode(c, mode), startAt);
        activeRef.current = i;
        setActive(i);
      }
      setAll(c);
    });
    return () => {
      live = false;
    };
    // Read once, at mount, like `startAt` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // ---- progress ----------------------------------------------------------
  // timeUpdate arrives every 250ms; animate linearly between updates on the
  // native driver so the bar moves smoothly at the display's refresh rate.
  const [progress] = useState(() => new Animated.Value(0));
  const lastFrac = useRef(0);
  const onTime = useCallback(
    (s: number, currentTime: number) => {
      const player = players[s];
      if (slotIndex[s] !== activeRef.current || !player.duration) return;
      const frac = Math.min(1, currentTime / player.duration);
      if (frac < lastFrac.current) progress.setValue(frac); // looped
      else
        Animated.timing(progress, {
          toValue: Math.min(1, frac + (0.25 * player.playbackRate) / player.duration),
          duration: 250,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
      lastFrac.current = frac;
    },
    [players, progress, slotIndex],
  );
  useEventListener(p0, 'timeUpdate', (e) => onTime(0, e.currentTime));
  useEventListener(p1, 'timeUpdate', (e) => onTime(1, e.currentTime));
  useEventListener(p2, 'timeUpdate', (e) => onTime(2, e.currentTime));
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    lastFrac.current = 0;
  }, [active, progress]);
  useEffect(() => {
    if (paused) progress.stopAnimation();
  }, [paused, progress]);

  // ---- paging ------------------------------------------------------------
  const settleAt = useCallback(
    (offset: number) => {
      if (!size.h) return;
      const i = indexFromOffset(offset, size.h, clips.length);
      if (i === activeRef.current) return;
      activeRef.current = i;
      setActive(i);
      // A new item always starts playing at normal speed.
      setPaused(false);
      setBoost(false);
    },
    [size.h, clips.length],
  );
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => settleAt(e.nativeEvent.contentOffset.y);
  // Released exactly on a page with no velocity: no momentum phase follows.
  const onDragEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (isOnPage(y, size.h) && !e.nativeEvent.velocity?.y) settleAt(y);
  };
  // Browsers have no drag-end or momentum-end events (React Native Web never
  // fires them), so a swipe never changed the active clip: the first clip kept
  // playing, with its sound, under the ones scrolled to. Settle once scrolling
  // has rested on a page instead (CSS scroll snapping puts it there).
  const webSettle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(webSettle.current), []);
  const onWebScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    clearTimeout(webSettle.current);
    webSettle.current = setTimeout(() => {
      if (isOnPage(y, size.h)) settleAt(y);
    }, WEB_SETTLE_MS);
  };

  // Rotation / iPad window resize: keep the same item in view.
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === size.w && height === size.h) return;
    setSize({ w: width, h: height });
  };
  useEffect(() => {
    if (size.h) listRef.current?.scrollToOffset({ offset: activeRef.current * size.h, animated: false });
  }, [size.h]);

  // Wait for the first page so placeholders never jump ahead of remote clips.
  const onEndReached = () => {
    if (!filter) setAll((c) => (c.length ? [...c, ...makeClips(c.length, 12)] : c));
  };

  // ---- jump to a clip (profile tile) ---------------------------------------
  // If the index isn't loaded yet, grow the list and land once the new
  // content size arrives; otherwise land right away.
  const clipCount = useRef(clips.length);
  useEffect(() => {
    clipCount.current = clips.length;
  }, [clips.length]);
  const pendingJump = useRef<number | null>(null);
  const landOn = useCallback(
    (i: number) => {
      if (!size.h) return;
      listRef.current?.scrollToOffset({ offset: i * size.h, animated: false });
      if (i === activeRef.current) return;
      activeRef.current = i;
      setActive(i);
      setPaused(false);
      setBoost(false);
    },
    [size.h],
  );
  useImperativeHandle(
    ref,
    () => ({
      jumpTo: (feedIndex: number) => {
        if (filter) {
          landOn(shownIndexOf(clips, feedIndex));
          return;
        }
        const i = feedIndex;
        if (i < clipCount.current) {
          landOn(i);
          return;
        }
        pendingJump.current = i;
        setAll((c) => (c.length > i ? c : [...c, ...makeClips(c.length, i + 6 - c.length)]));
      },
    }),
    [landOn, filter, clips],
  );
  const onContentSizeChange = (_w: number, contentH: number) => {
    const i = pendingJump.current;
    if (i === null || !size.h || contentH < (i + 1) * size.h) return;
    pendingJump.current = null;
    landOn(i);
  };

  // ---- sheet shrink ------------------------------------------------------
  // While a comments/share sheet is up, the whole list is scaled down into the
  // space above it. Both transforms and the overlay fade run on the native
  // driver from the sheet's progress value, so they track drags frame by frame.
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shrink = shrinkGeometry(size.h, winH, insets.top);
  const shrinkStyle = useMemo(
    () => ({
      transform: [
        { translateY: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [0, shrink.dy] }) },
        { scale: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [1, shrink.scale] }) },
      ],
    }),
    [sheetProgress, shrink.dy, shrink.scale],
  );
  const chrome = useMemo(
    () => sheetProgress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' }),
    [sheetProgress],
  );

  // ---- interactions --------------------------------------------------------
  const social = useSocial();
  const actions = useSocialActions();
  const nav = useAppNav();
  const liked = useMemo(() => new Set(social.liked.map((e) => e.id)), [social.liked]);
  const saved = useMemo(() => new Set(social.saved.map((e) => e.id)), [social.saved]);
  const reposted = useMemo(() => new Set(social.reposted.map((e) => e.id)), [social.reposted]);
  const sent = useMemo(() => new Set(social.sent.map((e) => e.id)), [social.sent]);
  const followed = useMemo(() => new Set(social.followed), [social.followed]);

  // Web: apply a change to the active player inside the tap that made it.
  // Safari only lets a video start, or unmute, during a user gesture; done
  // later from an effect, unmuting pauses the clip instead.
  const applyNow = useCallback(
    (change: Partial<PlaybackState>) => {
      // Kept current so a second change in the same tap builds on this one.
      const next = { ...playback.current, ...change };
      playback.current = next;
      const { slotIndex: slots, active: at, loaded: held } = pool.current;
      const s = slots.indexOf(at);
      if (Platform.OS === 'web' && s >= 0 && held[s] === at) {
        applyPlan(players[s], planFor(true, next, REPLAY_RATE));
      }
    },
    [players, applyPlan],
  );
  const setSlowmoNow = useCallback(
    (on: boolean) => {
      applyNow({ slowmo: on });
      setSlowmo(on);
    },
    [applyNow],
  );

  // Dev: an `[audio]` line in the Metro log whenever any player's state
  // changes, flagging doubled audio, sound while muted and off-screen playback.
  useEffect(() => {
    if (!__DEV__ || Platform.OS === 'web') return;
    let last = '';
    const t = setInterval(() => {
      const { slotIndex: slots, active: at, loaded: held } = pool.current;
      const snap = players.map((p, s) => ({
        slot: s,
        index: slots[s],
        loaded: held[s] === slots[s],
        active: slots[s] === at && held[s] === at,
        muted: p.muted,
        playing: p.playing,
        volume: p.volume,
        rate: p.playbackRate,
        status: p.status,
      }));
      const { line, problems } = describeAudio(playback.current.muted, at, snap);
      const out = `players=${playersCreated} ${line}${problems.length ? ` !! ${problems.join('; ')}` : ''}`;
      if (out === last) return;
      last = out;
      console.log(`[audio] ${out}`);
    }, AUDIO_LOG_MS);
    return () => clearInterval(t);
  }, [players]);

  // iOS can change a player on its own (KVO echoes of an earlier mute, the
  // loop restarting, an audio session change). Whenever a player reports it
  // started or was unmuted against what it was told, stop or mute it again.
  // Native only: the web player reports `playing` after a source change even
  // while its <video> stays paused.
  const guard = useCallback(
    (s: number) => {
      if (Platform.OS === 'web') return;
      const { slotIndex: slots, active: at, loaded: held } = pool.current;
      const player = players[s];
      const plan = planFor(slots[s] === at && held[s] === at, playback.current, REPLAY_RATE);
      const ops = guardOps({ muted: player.muted, playing: player.playing }, plan);
      if (!ops.length) return;
      if (__DEV__) console.log(`[audio] corrected slot ${s}: ${ops.join(', ')}`);
      runOps(player, ops, plan, () => {});
    },
    [players],
  );
  useEventListener(p0, 'playingChange', () => guard(0));
  useEventListener(p1, 'playingChange', () => guard(1));
  useEventListener(p2, 'playingChange', () => guard(2));
  useEventListener(p0, 'mutedChange', () => guard(0));
  useEventListener(p1, 'mutedChange', () => guard(1));
  useEventListener(p2, 'mutedChange', () => guard(2));

  const changePaused = useCallback(
    (next: boolean) => {
      applyNow({ paused: next });
      setPaused(next);
    },
    [applyNow],
  );

  const toggleMute = useCallback(() => {
    const next = !playback.current.muted;
    applyNow({ muted: next });
    setMuted(next);
  }, [applyNow]);

  const handlers = useMemo<FeedHandlers>(
    () => ({
      togglePause: () => changePaused(!paused),
      play: () => changePaused(false),
      pause: () => changePaused(true),
      like: actions.like,
      toggleLike: actions.toggleLike,
      toggleSave: actions.toggleSave,
      toggleRepost: actions.toggleRepost,
      toggleFollow: actions.toggleFollow,
      openComments: (clip) => nav.openSheet('comments', clip),
      openShare: (clip) => nav.openSheet('share', clip),
      setBoost: (on: boolean) => {
        if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        applyNow({ boost: on });
        setBoost(on);
      },
      setSlowmo: setSlowmoNow,
    }),
    [actions, nav, changePaused, paused, applyNow, setSlowmoNow],
  );

  const renderItem = ({ item, index }: { item: Clip; index: number }) => {
    const s = slotIndex.indexOf(index);
    const player = s >= 0 && loaded[s] === index ? players[s] : null;
    return (
      <ClipItem
        clip={item}
        width={size.w}
        height={size.h}
        wide={wide}
        player={player}
        isActive={index === active}
        paused={index === active && paused}
        boost={index === active && boost}
        liked={liked.has(clipKey(item))}
        saved={saved.has(clipKey(item))}
        reposted={reposted.has(clipKey(item))}
        sent={sent.has(clipKey(item))}
        followed={followed.has(item.author)}
        myComments={social.comments[clipKey(item)]?.length ?? 0}
        others={social.stats[clipKey(item)]}
        label={autoLabel(item, feedMode)}
        progress={progress}
        chrome={chrome}
        h={handlers}
      />
    );
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {/* Mounted once the clips are in, so it can open on `startAt`. */}
      {size.h > 0 && clips.length > 0 && (
        <Animated.FlatList
          style={[sheetOpen && styles.shrunk, shrinkStyle]}
          ref={listRef}
          data={clips}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          extraData={[active, loaded, paused, boost, social, wide, size, feedMode]}
          getItemLayout={(_, i) => ({ length: size.h, offset: size.h * i, index: i })}
          initialScrollIndex={active}
          pagingEnabled
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          scrollsToTop={false}
          contentInsetAdjustmentBehavior="never"
          onMomentumScrollEnd={onMomentumEnd}
          onScrollEndDrag={onDragEnd}
          onScroll={Platform.OS === 'web' ? onWebScroll : undefined}
          onEndReached={onEndReached}
          onEndReachedThreshold={3}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews
          scrollEnabled={!sheetOpen}
          onContentSizeChange={onContentSizeChange}
        />
      )}
      {filter && all.length > 0 && clips.length === 0 && <FeedEmpty verdict={filter} />}
      <TopBar muted={muted} onToggleMute={toggleMute} opacity={chrome} hidden={sheetOpen} />
    </View>
  );
}

/** Applies `opsFor`/`guardOps` calls to an expo-video player. */
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

/** Dev: how often the audio readout samples the players. */
const AUDIO_LOG_MS = 250;
/** Dev: players created since launch; more than three means some were recreated. */
let playersCreated = 0;

/** Quiet time after the last scroll event before a browser's swipe counts as settled. */
const WEB_SETTLE_MS = 120;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  // Corner radius is in unscaled points; at the shrunk scale it reads as ~12pt.
  shrunk: { borderRadius: 36, overflow: 'hidden' },
});

export type FeedHandlers = {
  togglePause: () => void;
  play: () => void;
  pause: () => void;
  /** Returns false when it didn't run (a guest is asked to sign in). */
  like: (clip: Clip) => boolean;
  toggleLike: (clip: Clip) => void;
  toggleSave: (clip: Clip) => void;
  toggleRepost: (clip: Clip) => void;
  toggleFollow: (author: string) => void;
  openComments: (clip: Clip) => void;
  openShare: (clip: Clip) => void;
  setBoost: (on: boolean) => void;
  /** Slow-motion, muted playback for the tells walkthrough's replays. */
  setSlowmo: (on: boolean) => void;
};
