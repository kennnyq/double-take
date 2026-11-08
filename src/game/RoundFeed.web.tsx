import { useState } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { DesktopFeed, type DesktopFeedHandle } from '@/desktop/DesktopFeed';
import { Feed, type FeedHandle } from '@/feed/Feed';
import type { FeedMode } from '@/feed/mode';
import { SocialProvider } from '@/social/store';
import { isDesktop } from './frame';
import '@/desktop/desktop.css';

export interface RoundFeedHandle {
  goTo: (index: number) => void;
}

/**
 * Browsers: the desktop feed at desktop sizes, the phone feed below them,
 * as the app picks (see `RoundFeed.tsx`).
 */
export function RoundFeed({ mode, live, ref }: { mode: FeedMode; live: boolean; ref?: React.Ref<RoundFeedHandle> }) {
  const win = useWindowDimensions();
  const [sheet] = useState(() => new Animated.Value(0));
  return (
    <SocialProvider>
      <View style={styles.fill} testID="game-stage">
        {isDesktop(win.width, win.height) ? (
          <DesktopFeed visible={live} scrollEnabled mode={mode} ref={ref as React.Ref<DesktopFeedHandle>} />
        ) : (
          <Feed focused={live} sheetOpen={false} sheetProgress={sheet} mode={mode} ref={ref as React.Ref<FeedHandle>} />
        )}
      </View>
    </SocialProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
