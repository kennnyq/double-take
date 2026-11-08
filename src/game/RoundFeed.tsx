import { useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Feed, type FeedHandle } from '@/feed/Feed';
import type { FeedMode } from '@/feed/mode';
import { SocialProvider } from '@/social/store';

export interface RoundFeedHandle {
  goTo: (index: number) => void;
}

/**
 * The round runs in the app's own feed, in a mode (see `src/feed/mode.ts`):
 * phones and tablets get the phone feed; desktop browsers get the desktop
 * feed (`RoundFeed.web.tsx`). Its own social store: the round's pages show
 * the clips' controls locked, and leave the viewer's real likes alone.
 */
export function RoundFeed({ mode, live, ref }: { mode: FeedMode; live: boolean; ref?: React.Ref<RoundFeedHandle> }) {
  const [sheet] = useState(() => new Animated.Value(0));
  return (
    <SocialProvider>
      <View style={styles.fill} testID="game-stage">
        <Feed focused={live} sheetOpen={false} sheetProgress={sheet} mode={mode} ref={ref as React.Ref<FeedHandle>} />
      </View>
    </SocialProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
