import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Placeholder } from '@/ui/Placeholder';
import { TABS, TabBar, type TabId } from '@/ui/TabBar';

export default function Home() {
  const [tab, setTab] = useState<TabId>('takes');
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <View style={styles.root}>
      <View style={styles.main}>
        <Placeholder title={current.label} icon={current.iconActive} />
      </View>
      <TabBar tab={tab} onTab={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  main: { flex: 1 },
});
