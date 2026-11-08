import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { CircleUserRound, House, LogIn, LogOut, Plus, Send, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { openSignIn, signOutToChoice } from '@/auth/gate';
import { useAuth, useMe } from '@/auth/store';
import { CommentsSheet } from '@/comments/CommentsSheet';
import type { Clip } from '@/data/clips';
import { Profile } from '@/profile/Profile';
import { SettingsScreen } from '@/settings/SettingsScreen';
import { openSettings, useSettingsOpen } from '@/settings/store';
import { ShareSheet } from '@/share/ShareSheet';
import { clipIndex } from '@/social/clipRefs';
import { AppNavContext, type AppNav, type ProfileTab, type SheetKind } from '@/social/nav';
import { DesktopFeed, type DesktopFeedHandle } from './DesktopFeed';
import { Logo } from './Logo';
// Sets the palette's --dt-* colours that desktop.css reads.
import '@/ui/theme';
import './desktop.css';

type DesktopTab = 'home' | 'messages' | 'create' | 'profile';

const NAV: { id: DesktopTab; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'messages', label: 'Messages', icon: Send },
  { id: 'create', label: 'Create', icon: Plus },
  { id: 'profile', label: 'Profile', icon: CircleUserRound },
];

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
  const { status } = useAuth();
  const me = useMe();

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
        <nav className="rail" aria-label="Main">
          <button className="rail-logo" onClick={onLogo ?? (() => setTab('home'))} aria-label="Double Take home page">
            <Logo />
          </button>
          <div className="rail-items">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`rail-item ${tab === id ? 'active' : ''}`}
                onClick={() => (id === 'create' ? openCreate() : setTab(id))}
                aria-label={label}
                aria-current={tab === id ? 'page' : undefined}
                data-tip={label}
              >
                <Icon size={26} strokeWidth={tab === id ? 2.6 : 1.9} />
              </button>
            ))}
          </div>
          <div className="rail-bottom">
            {status === 'guest' && (
              <button className="rail-item" onClick={() => openSignIn()} aria-label="Log in" aria-haspopup="dialog" data-tip="Log in">
                <LogIn size={25} strokeWidth={1.9} />
              </button>
            )}
            {status === 'member' && (
              <button className="rail-item" onClick={() => signOutToChoice()} aria-label={`Sign out @${me.handle}`} data-tip={`Sign out @${me.handle}`}>
                <LogOut size={24} strokeWidth={1.9} />
              </button>
            )}
            <button
              className={`rail-item ${settingsOpen ? 'active' : ''}`}
              onClick={openSettings}
              aria-label="Settings"
              aria-haspopup="dialog"
              data-tip="Settings"
            >
              <Settings size={25} strokeWidth={settingsOpen ? 2.6 : 1.9} />
            </button>
          </div>
        </nav>

        <main className="desk-main">
          {/* The feed stays mounted so its position survives tab switches; it pauses when hidden. */}
          <div className="tab-pane" hidden={tab !== 'home'}>
            <DesktopFeed ref={feedRef} visible={tab === 'home' && !uploadOpen} scrollEnabled={sheet === null && !settingsOpen} />
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
