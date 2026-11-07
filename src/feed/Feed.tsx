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
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { makeClips, type Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { useSocialActions } from '@/social/actions';
import { useAppNav } from '@/social/nav';
import { useSocial } from '@/social/store';
import { POOL_SIZE, indexFromOffset, isOnPage, isWideLayout, poolWindow } from './pool';
import { shrinkGeometry } from './shrink';
import { ClipItem } from './ClipItem';
import { TopBar } from './TopBar';

interface FeedProps {
  focused: boolean;
  /** A comments/share sheet is up (or animating): lock scrolling, round the shrunk page. */
  sheetOpen: boolean;
  /** 0..1 sheet position, driven on the native thread by the sheet. Shrinks the active page. */
  sheetProgress: Animated.Value;
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
export function Feed({ focused, sheetOpen, sheetProgress, ref }: FeedProps) {
  // Empty until the first page arrives (remote clips, then placeholders).
  const [clips, setClips] = useState<Clip[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(0);
  // Browsers require a user gesture before playing video with sound.
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const [paused, setPaused] = useState(false);
  const [boost, setBoost] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const listRef = useRef<FlatList<Clip>>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const wide = isWideLayout(size.w, size.h);

  // ---- players -----------------------------------------------------------
  const setup = (p: VideoPlayer) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  };
  const p0 = useVideoPlayer(null, setup);
  const p1 = useVideoPlayer(null, setup);
  const p2 = useVideoPlayer(null, setup);
  const players = useMemo(() => [p0, p1, p2], [p0, p1, p2]);

  const slotIndex = useMemo(() => poolWindow(active, clips.length), [active, clips.length]);
  // Which item each player has finished loading (-1 while loading). Views only
  // attach a player once it holds their clip, so a recycled player never
  // flashes the previous clip's frame.
  const [loaded, setLoaded] = useState<number[]>(() => Array(POOL_SIZE).fill(-1));
  const loadGen = useRef<number[]>(Array(POOL_SIZE).fill(0));
  const wanted = useRef<number[]>(Array(POOL_SIZE).fill(-1));

  useEffect(() => {
    slotIndex.forEach((idx, s) => {
      if (idx < 0 || wanted.current[s] === idx) return;
      wanted.current[s] = idx;
      const gen = ++loadGen.current[s];
      setLoaded((l) => (l[s] === -1 ? l : l.map((v, i) => (i === s ? -1 : v))));
      const player = players[s];
      player.pause();
      player.muted = true;
      player
        .replaceAsync(clips[idx].video)
        .then(() => {
          if (loadGen.current[s] !== gen) return; // superseded by a newer load
          setLoaded((l) => l.map((v, i) => (i === s ? idx : v)));
        })
        .catch(() => {});
    });
  }, [slotIndex, players, clips]);

  // Apply play/pause/mute/rate to every player whenever anything relevant changes.
  useEffect(() => {
    const live = focused && appActive;
    slotIndex.forEach((idx, s) => {
      const player = players[s];
      const isActive = idx === active && loaded[s] === idx;
      if (isActive && live) {
        player.muted = muted;
        player.playbackRate = boost ? 2 : 1;
        if (paused) player.pause();
        else player.play();
      } else {
        player.pause();
        player.muted = true;
        player.playbackRate = 1;
      }
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
  }, [slotIndex, loaded, active, focused, appActive, muted, paused, boost, players]);

  useEffect(() => {
    let live = true;
    loadInitialClips().then((c) => live && setClips(c));
    return () => {
      live = false;
    };
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
  const onEndReached = () => setClips((c) => (c.length ? [...c, ...makeClips(c.length, 12)] : c));

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
      jumpTo: (i: number) => {
        if (i < clipCount.current) {
          landOn(i);
          return;
        }
        pendingJump.current = i;
        setClips((c) => (c.length > i ? c : [...c, ...makeClips(c.length, i + 6 - c.length)]));
      },
    }),
    [landOn],
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

  const changePaused = useCallback(
    (next: boolean) => {
      // Resume within the tap handler so Safari retains the user gesture.
      const s = slotIndex.indexOf(active);
      if (Platform.OS === 'web' && s >= 0 && loaded[s] === active && focused && appActive) {
        if (next) players[s].pause();
        else players[s].play();
      }
      setPaused(next);
    },
    [slotIndex, active, loaded, focused, appActive, players],
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    const s = slotIndex.indexOf(active);
    // Unmuting in an effect loses Safari's user activation and pauses playback.
    if (Platform.OS === 'web' && s >= 0 && loaded[s] === active) {
      const player = players[s];
      // eslint-disable-next-line react-hooks/immutability -- Expo VideoPlayer uses imperative mutable properties.
      player.muted = next;
    }
    setMuted(next);
  }, [muted, slotIndex, active, loaded, players]);

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
        setBoost(on);
      },
    }),
    [actions, nav, changePaused, paused],
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
        liked={liked.has(item.id)}
        saved={saved.has(item.id)}
        reposted={reposted.has(item.id)}
        sent={sent.has(item.id)}
        followed={followed.has(item.author)}
        myComments={social.comments[item.id]?.length ?? 0}
        progress={progress}
        chrome={chrome}
        h={handlers}
      />
    );
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {size.h > 0 && (
        <Animated.FlatList
          style={[sheetOpen && styles.shrunk, shrinkStyle]}
          ref={listRef}
          data={clips}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          extraData={[active, loaded, paused, boost, social, wide, size]}
          getItemLayout={(_, i) => ({ length: size.h, offset: size.h * i, index: i })}
          pagingEnabled
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          scrollsToTop={false}
          contentInsetAdjustmentBehavior="never"
          onMomentumScrollEnd={onMomentumEnd}
          onScrollEndDrag={onDragEnd}
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
      <TopBar muted={muted} onToggleMute={toggleMute} opacity={chrome} hidden={sheetOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  // Corner radius is in unscaled points; at the shrunk scale it reads as ~12pt.
  shrunk: { borderRadius: 36, overflow: 'hidden' },
});

export type FeedHandlers = {
  togglePause: () => void;
  play: () => void;
  pause: () => void;
  like: (clip: Clip) => void;
  toggleLike: (clip: Clip) => void;
  toggleSave: (clip: Clip) => void;
  toggleRepost: (clip: Clip) => void;
  toggleFollow: (author: string) => void;
  openComments: (clip: Clip) => void;
  openShare: (clip: Clip) => void;
  setBoost: (on: boolean) => void;
};
