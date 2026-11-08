import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { Rail, requestDesktopTab, type DesktopTab } from '@/desktop/Rail';
import type { TabId } from '@/ui/TabBar';
import { openSettings } from '@/settings/store';
import { FrameContext, isDesktop, useGameScreen } from './frame';
import { PhoneFrame } from './PhoneFrame';
// The rail's styles, and the palette's --dt-* colours they read.
import '@/ui/theme';
import '@/desktop/desktop.css';

export { leaveForTab } from './PhoneFrame';

/**
 * Desktop browsers: a game screen sits in the app's page, beside the same
 * rail as the feed; picking a tab there goes back to the app on that tab.
 * Narrow browsers get the phone's frame.
 */
export function GameFrame({ children, tab }: { children: ReactNode; tab?: TabId }) {
  const win = useWindowDimensions();
  if (!isDesktop(win.width, win.height)) return <PhoneFrame tab={tab}>{children}</PhoneFrame>;
  return <DesktopFrame railTab={tab === 'skills' ? 'skills' : null}>{children}</DesktopFrame>;
}

function DesktopFrame({ children, railTab }: { children: ReactNode; railTab: DesktopTab | null }) {
  useGameScreen();
  const win = useWindowDimensions();
  const [size, setSize] = useState({ width: win.width - 72, height: win.height });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height && (width !== size.width || height !== size.height)) setSize({ width, height });
  };
  const back = () => router.dismissTo('/');
  return (
    <div className="desk">
      <Rail
        tab={railTab}
        onTab={(t) => {
          if (t === railTab) return;
          // Skills is a route of its own; the other tabs are the app's, shown as it comes back.
          if (t === 'skills') return router.replace('/skills');
          requestDesktopTab(t);
          back();
        }}
        onLogo={() => {
          requestDesktopTab('home');
          back();
        }}
        settingsOpen={false}
        onSettings={() => {
          back();
          openSettings();
        }}
      />
      <main className="desk-main">
        <View style={styles.fill} onLayout={onLayout}>
          <FrameContext.Provider value={{ ...size, desktop: true, top: 0 }}>{children}</FrameContext.Provider>
        </View>
      </main>
    </div>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
});
