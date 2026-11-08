import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar, requestTab, type TabId } from '@/ui/TabBar';
import { usePalette } from '@/ui/theme';
import { FrameContext, isDesktop, type FrameSize } from './frame';

/** Leaves the game for one of the app's tabs. */
export function leaveForTab(tab: TabId) {
  if (tab === 'settings') {
    router.dismissTo('/settings');
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
export function PhoneFrame({ children }: { children: ReactNode }) {
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
      <TabBar tab="settings" onTab={leaveForTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 1, overflow: 'hidden' },
});
