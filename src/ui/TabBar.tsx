import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type TabId = 'home' | 'takes' | 'create' | 'you';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const TABS: { id: TabId; label: string; icon: IconName; iconActive: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { id: 'takes', label: 'Takes', icon: 'film-outline', iconActive: 'film' },
  { id: 'create', label: 'Create', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { id: 'you', label: 'You', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

const STRIP_TOP = 8;
const PILL_H = 58;
const stripBottom = (bottomInset: number) => Math.max(bottomInset - 8, 8);

/** Total height of the tab bar strip for a given bottom safe-area inset. */
export const tabBarHeight = (bottomInset: number) => STRIP_TOP + PILL_H + stripBottom(bottomInset);

/** Floating pill tab bar on a black strip. */
export function TabBar({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.strip, { paddingBottom: stripBottom(insets.bottom) }]}>
      <View style={styles.pill}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                if (!on) Haptics.selectionAsync();
                onTab(t.id);
              }}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={on ? t.iconActive : t.icon} size={t.id === 'create' ? 28 : 25} color="#f1f1f1" />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { backgroundColor: '#000', paddingTop: STRIP_TOP, paddingHorizontal: 12, alignItems: 'center' },
  pill: {
    width: '100%',
    maxWidth: 440,
    height: PILL_H,
    borderRadius: 999,
    backgroundColor: '#1f1f1f',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
  },
  tab: { height: 44, width: 84, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#3d3d3d' },
});
