import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsContent } from '@/settings/SettingsScreen';
import { openSettings } from '@/settings/store';
import { TabBar, requestTab, type TabId } from '@/ui/TabBar';
import { usePalette } from '@/ui/theme';

/**
 * The phone's Settings tab. Pushed over the Home screen without animation, so
 * it reads as a tab: the feed stays mounted underneath and pauses while this
 * is up (Home checks `useIsFocused`). Picking another tab goes back to Home
 * on that tab.
 *
 * Desktop web keeps Settings as a dialog over the feed; opened here at that
 * size (a link, a resized window), it hands over to the dialog.
 */
export default function SettingsTab() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const c = usePalette();
  // Same test as Home's for the desktop layout.
  const desktop = Platform.OS === 'web' && width >= 760 && height >= 480;

  useEffect(() => {
    if (desktop) openSettings();
  }, [desktop]);
  if (desktop) return <Redirect href="/" />;

  const onTab = (tab: TabId) => {
    if (tab === 'settings') return;
    requestTab(tab);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title} role="heading">
          Settings
        </Text>
      </View>
      <SettingsContent wide={false} style={styles.content} />
      <TabBar tab="settings" onTab={onTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  content: { flex: 1 },
});
