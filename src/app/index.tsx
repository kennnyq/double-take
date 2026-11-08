import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SignInSheet } from '@/auth/SignInSheet';
import { AuthBoot } from '@/auth/store';
import type { Clip } from '@/data/clips';
import { CommentsSheet } from '@/comments/CommentsSheet';
import { DesktopApp } from '@/desktop/DesktopApp';
import { DevSettings } from '@/devtools/DevSettings';
import { useDevSettings } from '@/devtools/store';
import { Feed, type FeedHandle } from '@/feed/Feed';
import { WithLanding } from '@/landing/WithLanding';
import { Profile } from '@/profile/Profile';
import { closeSettings, useSettingsOpen } from '@/settings/store';
import { ShareSheet } from '@/share/ShareSheet';
import { clipIndex } from '@/social/clipRefs';
import { AppNavContext, type AppNav, type ProfileTab, type SheetKind } from '@/social/nav';
import { SocialProvider } from '@/social/store';
import { SocialSync } from '@/social/SocialSync';
import { Placeholder } from '@/ui/Placeholder';
import { TABS, TabBar, onTabRequest, type TabId } from '@/ui/TabBar';
import { UploadModal } from '@/upload/UploadModal';
import { uploadRoute } from '@/investigation/upload-flow';
import { ToastProvider } from '@/ui/Toast';

export default function Home() {
  const { width, height } = useWindowDimensions();
  const { check } = useLocalSearchParams<{ check?: string }>();
  const savedCheck = uploadRoute({ pending: check }).pendingId;
  const [uploadOpen, setUploadOpen] = useState(!!savedCheck);
  const [shownCheck, setShownCheck] = useState(savedCheck);
  if (savedCheck !== shownCheck) {
    setShownCheck(savedCheck);
    if (savedCheck) setUploadOpen(true);
  }
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => setUploadOpen(false), []);
  // Desktop browsers get the Reels-style layout; it needs room for the side info and action columns.
  const desktop = Platform.OS === 'web' && width >= 760 && height >= 480;
  return (
    <SocialProvider>
      <AuthBoot />
      <SocialSync />
      <ToastProvider>
        {/* Web shows a landing page first; the apps open on the feed. */}
        <WithLanding>
          {(startAt, showLanding) => (
            <>
              {desktop ? <DesktopApp startAt={startAt} onLogo={showLanding} onUpload={openUpload} uploadOpen={uploadOpen} /> : <Screen startAt={startAt} onUpload={openUpload} uploadOpen={uploadOpen} />}
              {/* Dev builds: a launcher for the tabbed dev settings. */}
              <DevSettings desktop={desktop} onShowLanding={showLanding} />
              {/* Opened by the auth gate when a guest tries to act, or by a log-in button. */}
              <SignInSheet />
              <UploadModal open={uploadOpen} onClose={closeUpload} />
            </>
          )}
        </WithLanding>
      </ToastProvider>
    </SocialProvider>
  );
}

function Screen({ startAt, onUpload, uploadOpen }: { startAt?: number; onUpload: () => void; uploadOpen: boolean }) {
  const [tab, setTab] = useState<TabId>('home');
  const [profileTab, setProfileTab] = useState<ProfileTab>('reposts');
  const feedRef = useRef<FeedHandle>(null);
  // `sheet` stays set until the slide-out finishes; `sheetOpen` drives the slide.
  const [sheet, setSheet] = useState<{ kind: SheetKind; clip: Clip } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Shared by the open sheet (drives it) and the feed (shrinks the video with it).
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const screenFocused = useIsFocused();
  // The double take is open on the feed: the tab bar may fade with its chrome (dev setting).
  const [inspecting, setInspecting] = useState(false);
  const { tabBarInDoubleTake } = useDevSettings();
  const current = TABS.find((t) => t.id === tab)!;

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const onSheetClosed = useCallback(() => setSheet(null), []);

  // Settings is its own route: the tab, the profile menu and the feed's empty
  // state (through `openSettings`) all go there. Leaving it on another tab
  // brings that tab up here.
  const showTab = useCallback((t: TabId) => {
    if (t === 'create') onUpload();
    else if (t === 'settings') router.push('/settings');
    else setTab(t);
  }, [onUpload]);
  const settingsAsked = useSettingsOpen();
  useEffect(() => {
    if (!settingsAsked) return;
    closeSettings();
    router.push('/settings');
  }, [settingsAsked]);
  useEffect(() => onTabRequest(showTab), [showTab]);

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
      // The same as tapping the Create tab.
      openCreate: () => showTab('create'),
    }),
    [closeSheet, showTab],
  );

  const sheetProps = { open: sheetOpen, progress: sheetProgress, onRequestClose: closeSheet, onClosed: onSheetClosed };

  return (
    <AppNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={styles.main}>
          {/* Feed stays mounted so its position survives tab switches; it pauses when hidden. */}
          <View style={[StyleSheet.absoluteFill, tab !== 'home' && styles.hidden]}>
            <Feed
              focused={screenFocused && tab === 'home' && !uploadOpen}
              sheetOpen={sheet !== null}
              sheetProgress={sheetProgress}
              startAt={startAt}
              onInspectChange={setInspecting}
              ref={feedRef}
            />
          </View>
          {tab === 'you' && <Profile tab={profileTab} onTab={setProfileTab} />}
          {tab !== 'home' && tab !== 'you' && <Placeholder title={current.label} icon={current.iconActive} />}
        </View>
        <TabBar tab={tab} onTab={showTab} faded={tabBarInDoubleTake === 'fade' && inspecting && tab === 'home'} />
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
