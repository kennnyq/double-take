import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar, requestTab, type TabId } from '@/ui/TabBar';
import { usePalette } from '@/ui/theme';
import { FrameContext, isDesktop, useGameScreen, type FrameSize } from './frame';

/**
 * Leaves a screen over the app (a game screen, or the Skills tab, `here`) for
 * one of the app's tabs: Settings and Skills are routes of their own; the
 * others are views of the Home screen, shown as it comes back.
 */
export function leaveForTab(tab: TabId, here?: TabId) {
  if (tab === here) return;
  if (tab === 'skills') {
    router.replace('/skills');
    return;
  }
  if (tab === 'settings') {
    if (here === 'skills') router.replace('/settings');
    else router.dismissTo('/settings');
    return;
  }
  requestTab(tab);
  router.dismissTo('/');
}

/**
 * Phones: a game screen keeps the app's tab bar under it, as the feed does;
 * picking a tab leaves the game for it. (Desktop browsers: `GameFrame.web.tsx`
 * puts the rail beside it instead.)
 */
export function PhoneFrame({ children, tab = 'settings' }: { children: ReactNode; tab?: TabId }) {
  // No first-run gesture hint while a game screen is up (see `useGameScreen`).
  useGameScreen();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const c = usePalette();
  const [size, setSize] = useState({ width: win.width, height: win.height });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height && (width !== size.width || height !== size.height)) setSize({ width, height });
  };
  const frame: FrameSize = { ...size, desktop: isDesktop(win.width, win.height), top: insets.top };
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.main} onLayout={onLayout}>
        <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>
      </View>
      <TabBar tab={tab} onTab={(t) => leaveForTab(t, tab === 'skills' ? 'skills' : undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 1, overflow: 'hidden' },
});
