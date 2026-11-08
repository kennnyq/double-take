import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { Sparkles, type LucideIcon } from 'lucide-react';
import { CommentsSheet } from '@/comments/CommentsSheet';
import type { Clip } from '@/data/clips';
import { Profile } from '@/profile/Profile';
import { SettingsScreen } from '@/settings/SettingsScreen';
import { openSettings, useSettingsOpen } from '@/settings/store';
import { ShareSheet } from '@/share/ShareSheet';
import { clipIndex } from '@/social/clipRefs';
import { AppNavContext, type AppNav, type ProfileTab, type SheetKind } from '@/social/nav';
import { DesktopFeed, type DesktopFeedHandle } from './DesktopFeed';
import { NAV, RAIL_ROUTES, Rail, onDesktopTabRequest, type DesktopTab } from './Rail';
// Sets the palette's --dt-* colours that desktop.css reads.
import '@/ui/theme';
import './desktop.css';


/**
 * Desktop browsers: a left icon rail and the Reels-style feed as Home.
 * Shares the social store, toasts, profile and clip data with the app; only the
 * layout and the feed's input handling (wheel, keyboard, buttons) are desktop's own.
 */
export function DesktopApp({
  startAt,
  onLogo,
  onUpload,
  uploadOpen = false,
}: {
  onUpload: () => void;
  uploadOpen?: boolean;
  startAt?: number;
  /** The rail's logo: back to the landing page. */
  onLogo?: () => void;
}) {
  const [tab, setTab] = useState<DesktopTab>('home');
  const [profileTab, setProfileTab] = useState<ProfileTab>('reposts');
  const feedRef = useRef<DesktopFeedHandle>(null);
  // Share opens as the app's sheet (the feed docks its own comments panel); `sheet` stays set until the slide-out ends.
  const [sheet, setSheet] = useState<{ kind: SheetKind; clip: Clip } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const current = NAV.find((n) => n.id === tab)!;
  const settingsOpen = useSettingsOpen();
  // Another route (the timed round) is on top: the feed pauses and lets go of the wheel and keys.
  const focused = useIsFocused();

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const onSheetClosed = useCallback(() => setSheet(null), []);

  // Opened by the landing's launch: start on the clip that grew into the feed.
  useEffect(() => {
    if (startAt !== undefined) feedRef.current?.jumpTo(startAt);
  }, [startAt]);

  // Escape closes an open sheet, as a desktop dialog should.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, closeSheet]);

  // Create, from the rail or the profile's +.
  const openCreate = useCallback(() => {
    onUpload();
  }, [onUpload]);

  // A tab picked on the rail: Create asks for an account, Game and Skills are routes of their own.
  const pickTab = useCallback(
    (t: DesktopTab) => {
      if (t === 'create') openCreate();
      else if (RAIL_ROUTES[t]) router.push(RAIL_ROUTES[t]);
      else setTab(t);
    },
    [openCreate],
  );
  // …and on the rail of a route on top (Game, Skills, the timed round), which only asks for the app's own tabs.
  useEffect(() => onDesktopTabRequest((t) => (t === 'create' ? openCreate() : setTab(t))), [openCreate]);

  const nav = useMemo<AppNav>(
    () => ({
      openProfile: (t) => {
        setProfileTab(t);
        setTab('profile');
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
      openCreate,
    }),
    [closeSheet, openCreate],
  );

  const sheetProps = { open: sheetOpen, progress: sheetProgress, onRequestClose: closeSheet, onClosed: onSheetClosed };

  return (
    <AppNavContext.Provider value={nav}>
      <div className="desk">
        <Rail
          tab={tab}
          // Create goes through the app's nav (a guest is asked to sign in first); Skills is a route of its own.
          onTab={pickTab}
          onLogo={onLogo ?? (() => setTab('home'))}
          settingsOpen={settingsOpen}
          onSettings={openSettings}
        />

        <main className="desk-main">
          {/* The feed stays mounted so its position survives tab switches; it pauses when hidden. */}
          <div className="tab-pane" hidden={tab !== 'home'}>
            <DesktopFeed ref={feedRef} visible={tab === 'home' && focused && !uploadOpen} scrollEnabled={sheet === null && !settingsOpen} />
          </div>
          {tab === 'profile' && (
            <div className="desk-profile">
              <Profile tab={profileTab} onTab={setProfileTab} />
            </div>
          )}
          {tab !== 'home' && tab !== 'profile' && <Placeholder icon={current.icon} title={current.label} />}
        </main>
      </div>

      {sheet && (
        <div className="desk-sheets">
          {/* Keyed by clip so composer/search state starts fresh. */}
          {sheet.kind === 'comments' && <CommentsSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
          {sheet.kind === 'share' && <ShareSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
        </div>
      )}
      <SettingsScreen />
    </AppNavContext.Provider>
  );
}

/** Original "Double Take" mark: two offset rounded frames. */
function Placeholder({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="placeholder">
      <div className="placeholder-icon">
        <Icon size={36} />
      </div>
      <h2>{title}</h2>
      <p>
        <Sparkles size={14} /> Coming soon. The video feed and your profile work for now.
      </p>
    </div>
  );
}
