import { ChartColumn, CircleUserRound, CloudUpload, House, LogIn, LogOut, Send, Settings, type LucideIcon } from 'lucide-react';
import { openSignIn, signOutToChoice } from '@/auth/gate';
import { useAuth, useMe } from '@/auth/store';
import { Logo } from './Logo';

export type DesktopTab = 'home' | 'messages' | 'create' | 'profile' | 'skills';

export const NAV: { id: DesktopTab; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'messages', label: 'Messages', icon: Send },
  { id: 'create', label: 'Upload', icon: CloudUpload },
  { id: 'profile', label: 'Profile', icon: CircleUserRound },
  // Its own route (`src/app/skills.tsx`): the rail stays, the main area changes.
  { id: 'skills', label: 'Skills', icon: ChartColumn },
];

/**
 * The desktop's left icon rail (web only). The app shows it beside the feed;
 * routes on top of the app (the timed round) show it too, so the page keeps
 * its layout, and picking a tab there goes back to the app on that tab.
 */
export function Rail({
  tab,
  onTab,
  onLogo,
  settingsOpen,
  onSettings,
}: {
  /** The tab that's showing; null when another screen is (nothing lit). */
  tab: DesktopTab | null;
  /** A tab was picked (Upload too: the caller opens it through the app's nav). */
  onTab: (tab: DesktopTab) => void;
  onLogo: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
}) {
  const { status } = useAuth();
  const me = useMe();
  return (
    <nav className="rail" aria-label="Main">
      <button className="rail-logo" onClick={onLogo} aria-label="Double Take home page">
        <Logo />
      </button>
      <div className="rail-items">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`rail-item ${tab === id ? 'active' : ''}`}
            onClick={() => onTab(id)}
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
          onClick={onSettings}
          aria-label="Settings"
          aria-haspopup="dialog"
          data-tip="Settings"
        >
          <Settings size={25} strokeWidth={settingsOpen ? 2.6 : 1.9} />
        </button>
      </div>
    </nav>
  );
}

// ---- a tab picked on another route, for the desktop app to show when it's back ----

let pending: DesktopTab | null = null;
let listener: ((tab: DesktopTab) => void) | null = null;

/** Ask the desktop app to show `tab` (a route on top calls this as it goes back). */
export function requestDesktopTab(tab: DesktopTab) {
  if (listener) listener(tab);
  else pending = tab;
}

/** The desktop app listens for requested tabs; one asked for before it listened arrives at once. */
export function onDesktopTabRequest(fn: (tab: DesktopTab) => void): () => void {
  listener = fn;
  if (pending) {
    const t = pending;
    pending = null;
    fn(t);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
