import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { Clip } from '@/data/clips';
import { CommentsSheet } from '@/comments/CommentsSheet';
import { DesktopApp } from '@/desktop/DesktopApp';
import { Feed, type FeedHandle } from '@/feed/Feed';
import { WithLanding } from '@/landing/WithLanding';
import { Profile } from '@/profile/Profile';
import { ShareSheet } from '@/share/ShareSheet';
import { clipIndex } from '@/social/clipRefs';
import { AppNavContext, type AppNav, type ProfileTab, type SheetKind } from '@/social/nav';
import { SocialProvider } from '@/social/store';
import { Placeholder } from '@/ui/Placeholder';
import { TABS, TabBar, type TabId } from '@/ui/TabBar';
import { ToastProvider } from '@/ui/Toast';

export default function Home() {
  const { width, height } = useWindowDimensions();
  // Desktop browsers get the Reels-style layout; it needs room for the side info and action columns.
  const desktop = Platform.OS === 'web' && width >= 760 && height >= 480;
  return (
    <SocialProvider>
      <ToastProvider>
        {/* Web shows a landing page first; the apps open on the feed. */}
        <WithLanding>{(startAt) => (desktop ? <DesktopApp startAt={startAt} /> : <Screen startAt={startAt} />)}</WithLanding>
      </ToastProvider>
    </SocialProvider>
  );
}

function Screen({ startAt }: { startAt?: number }) {
  const [tab, setTab] = useState<TabId>('home');
  const [profileTab, setProfileTab] = useState<ProfileTab>('reposts');
  const feedRef = useRef<FeedHandle>(null);
  // `sheet` stays set until the slide-out finishes; `sheetOpen` drives the slide.
  const [sheet, setSheet] = useState<{ kind: SheetKind; clip: Clip } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Shared by the open sheet (drives it) and the feed (shrinks the video with it).
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const screenFocused = useIsFocused();
  const current = TABS.find((t) => t.id === tab)!;

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const onSheetClosed = useCallback(() => setSheet(null), []);

  const nav = useMemo<AppNav>(
    () => ({
      openProfile: (t) => {
        setProfileTab(t);
        setTab('you');
      },
      openClip: (clipId) => {
        setTab('home');
        feedRef.current?.jumpTo(clipIndex(clipId));
      },
      openSheet: (kind, clip) => {
        setSheet({ kind, clip });
        setSheetOpen(true);
      },
      closeSheet,
    }),
    [closeSheet],
  );

  const sheetProps = { open: sheetOpen, progress: sheetProgress, onRequestClose: closeSheet, onClosed: onSheetClosed };

  return (
    <AppNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={styles.main}>
          {/* Feed stays mounted so its position survives tab switches; it pauses when hidden. */}
          <View style={[StyleSheet.absoluteFill, tab !== 'home' && styles.hidden]}>
            <Feed
              focused={screenFocused && tab === 'home'}
              sheetOpen={sheet !== null}
              sheetProgress={sheetProgress}
              startAt={startAt}
              ref={feedRef}
            />
          </View>
          {tab === 'you' && <Profile tab={profileTab} onTab={setProfileTab} />}
          {tab !== 'home' && tab !== 'you' && <Placeholder title={current.label} icon={current.iconActive} />}
        </View>
        <TabBar tab={tab} onTab={setTab} />
        {/* Sheets sit above the tab bar; keyed by clip so composer/search state starts fresh. */}
        {sheet?.kind === 'comments' && <CommentsSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
        {sheet?.kind === 'share' && <ShareSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
      </View>
    </AppNavContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  main: { flex: 1 },
  hidden: { opacity: 0, pointerEvents: 'none' },
});
