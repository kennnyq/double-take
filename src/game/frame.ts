import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

/** Where a game screen lays itself out: the space the app's chrome leaves it. */
export interface FrameSize {
  width: number;
  height: number;
  /** The desktop layout (the rail beside it); phones have the tab bar below. */
  desktop: boolean;
  /** Safe-area space at the top still inside the frame (status bar); 0 on desktop. */
  top: number;
}

export const FrameContext = createContext<FrameSize>({ width: 0, height: 0, desktop: false, top: 0 });

export function useFrame(): FrameSize {
  return useContext(FrameContext);
}

/** Same test as Home's for the desktop layout. */
export function isDesktop(width: number, height: number): boolean {
  return Platform.OS === 'web' && width >= 760 && height >= 480;
}

/**
 * The round's stage in a frame: full width on phones, a 9:16 column on
 * desktop with room round it.
 */
export function stageSize(f: FrameSize): { width: number; height: number; marginTop: number } {
  if (!f.desktop) return { width: f.width, height: f.height, marginTop: 0 };
  const height = Math.max(0, f.height - 48);
  return { width: Math.min(f.width - 48, Math.round((height * 9) / 16)), height, marginTop: 24 };
}
