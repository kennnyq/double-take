import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import {
  Bell,
  CircleUserRound,
  Clapperboard,
  House,
  LayoutGrid,
  Menu,
  Plus,
  Search,
  Send,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { CommentsSheet } from '@/comments/CommentsSheet';
import type { Clip } from '@/data/clips';
import { Profile } from '@/profile/Profile';
import { ShareSheet } from '@/share/ShareSheet';
import { clipIndex } from '@/social/clipRefs';
import { AppNavContext, type AppNav, type ProfileTab, type SheetKind } from '@/social/nav';
import { DesktopFeed, type DesktopFeedHandle } from './DesktopFeed';
import './desktop.css';

type DesktopTab = 'home' | 'reels' | 'messages' | 'search' | 'activity' | 'create' | 'profile';

const NAV: { id: DesktopTab; label: string; icon: LucideIcon; dot?: boolean }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'reels', label: 'Reels', icon: Clapperboard },
  { id: 'messages', label: 'Messages', icon: Send },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'activity', label: 'Notifications', icon: Bell, dot: true },
  { id: 'create', label: 'Create', icon: Plus },
  { id: 'profile', label: 'Profile', icon: CircleUserRound },
];

/**
 * Desktop browsers: a left icon rail, the Reels-style feed and a Messages pill.
 * Shares the social store, toasts, profile and clip data with the app; only the
 * layout and the feed's input handling (wheel, keyboard, buttons) are desktop's own.
 */
export function DesktopApp() {
  const [tab, setTab] = useState<DesktopTab>('reels');
  const [profileTab, setProfileTab] = useState<ProfileTab>('reposts');
  const feedRef = useRef<DesktopFeedHandle>(null);
  // Comments and share open as the app's sheets for now; `sheet` stays set until the slide-out ends.
  const [sheet, setSheet] = useState<{ kind: SheetKind; clip: Clip } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const current = NAV.find((n) => n.id === tab)!;

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const onSheetClosed = useCallback(() => setSheet(null), []);

  // Escape closes an open sheet, as a desktop dialog should.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, closeSheet]);

  const nav = useMemo<AppNav>(
    () => ({
      openProfile: (t) => {
        setProfileTab(t);
        setTab('profile');
      },
      openClip: (clipId) => {
        setTab('reels');
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
      <div className="desk">
        <nav className="rail" aria-label="Main">
          <button className="rail-logo" onClick={() => setTab('reels')} aria-label="Double Take">
            <Logo />
          </button>
          <div className="rail-items">
            {NAV.map(({ id, label, icon: Icon, dot }) => (
              <button
                key={id}
                className={`rail-item ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
                aria-label={label}
                aria-current={tab === id ? 'page' : undefined}
                data-tip={label}
              >
                <Icon size={26} strokeWidth={tab === id ? 2.6 : 1.9} />
                {dot && <span className="notif-dot" />}
              </button>
            ))}
          </div>
          <div className="rail-bottom">
            <button className="rail-item" aria-label="More" data-tip="More">
              <Menu size={26} strokeWidth={1.9} />
            </button>
            <button className="rail-item" aria-label="Also from Double Take" data-tip="Apps">
              <LayoutGrid size={24} strokeWidth={1.9} />
            </button>
          </div>
        </nav>

        <main className="desk-main">
          {/* The feed stays mounted so its position survives tab switches; it pauses when hidden. */}
          <div className="tab-pane" hidden={tab !== 'reels'}>
            <DesktopFeed ref={feedRef} visible={tab === 'reels'} scrollEnabled={sheet === null} />
          </div>
          {tab === 'profile' && (
            <div className="desk-profile">
              <Profile tab={profileTab} onTab={setProfileTab} />
            </div>
          )}
          {tab !== 'reels' && tab !== 'profile' && <Placeholder icon={current.icon} title={current.label} />}
        </main>

        <button className="messages-pill" onClick={() => setTab('messages')} aria-label="Messages">
          <Send size={20} />
          <span>Messages</span>
          <span className="pill-avatars" aria-hidden>
            <i style={{ ['--hue' as string]: 200 }} />
            <i style={{ ['--hue' as string]: 320 }} />
            <i style={{ ['--hue' as string]: 40 }} />
          </span>
        </button>
      </div>

      {sheet && (
        <div className="desk-sheets">
          {/* Keyed by clip so composer/search state starts fresh. */}
          {sheet.kind === 'comments' && <CommentsSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
          {sheet.kind === 'share' && <ShareSheet key={sheet.clip.id} clip={sheet.clip} {...sheetProps} />}
        </div>
      )}
    </AppNavContext.Provider>
  );
}

/** Original "Double Take" mark: two offset rounded frames. */
function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Double Take">
      <rect x="3" y="7" width="17" height="22" rx="5" stroke="currentColor" strokeWidth="2.4" opacity="0.55" />
      <rect x="11" y="3" width="17" height="22" rx="5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M17.5 10.5v7l5.5-3.5-5.5-3.5Z" fill="currentColor" />
    </svg>
  );
}

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
