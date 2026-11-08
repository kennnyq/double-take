import { createContext, useContext } from 'react';
import type { Clip } from '@/data/clips';

export type ProfileTab = 'reposts' | 'shared' | 'liked' | 'saved';
export type SheetKind = 'comments' | 'share';

/** Screen-level navigation that features deep in the tree need. Provided by `src/app/index.tsx`. */
export interface AppNav {
  openProfile: (tab: ProfileTab) => void;
  /** Switch to the feed and jump straight to this clip. */
  openClip: (clipId: string) => void;
  openSheet: (kind: SheetKind, clip: Clip) => void;
  closeSheet: () => void;
  /**
   * Open Create: what the Create tab (phone) and the rail's Create (desktop)
   * do, so other entry points (the profile's +) open the same thing.
   */
  openCreate: () => void;
}

const noop = () => {};
export const AppNavContext = createContext<AppNav>({
  openProfile: noop,
  openClip: noop,
  openSheet: noop,
  closeSheet: noop,
  openCreate: noop,
});

export const useAppNav = () => useContext(AppNavContext);
