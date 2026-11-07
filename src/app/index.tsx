import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Feed } from '@/feed/Feed';
import { Placeholder } from '@/ui/Placeholder';
import { TABS, TabBar, type TabId } from '@/ui/TabBar';

export default function Home() {
  const [tab, setTab] = useState<TabId>('takes');
  const screenFocused = useIsFocused();
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <View style={styles.root}>
      <View style={styles.main}>
        {/* Feed stays mounted so its position survives tab switches; it pauses when hidden. */}
        <View style={[StyleSheet.absoluteFill, tab !== 'takes' && styles.hidden]}>
          <Feed focused={screenFocused && tab === 'takes'} />
        </View>
        {tab !== 'takes' && <Placeholder title={current.label} icon={current.iconActive} />}
      </View>
      <TabBar tab={tab} onTab={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  main: { flex: 1 },
  hidden: { opacity: 0, pointerEvents: 'none' },
});
