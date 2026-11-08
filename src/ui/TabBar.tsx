import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ownLayer } from '@/feed/layer';
import { useFadeProgress } from '@/feed/motion';

export type TabId = 'home' | 'create' | 'you' | 'skills' | 'settings';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const TABS: { id: TabId; label: string; icon: IconName; iconActive: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { id: 'create', label: 'Upload', icon: 'cloud-upload-outline', iconActive: 'cloud-upload' },
  { id: 'you', label: 'You', icon: 'person-circle-outline', iconActive: 'person-circle' },
  // Its own route (`src/app/skills.tsx`), like Settings.
  { id: 'skills', label: 'Skills', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  // Its own route (`src/app/settings.tsx`); the others are views of the Home screen.
  { id: 'settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

// ---- a tab picked on the Settings route, for the Home screen to show when it's back ----

let pending: TabId | null = null;
let listener: ((tab: TabId) => void) | null = null;

/** Ask the Home screen to show `tab` (the Settings route calls this as it goes back). */
export function requestTab(tab: TabId) {
  if (listener) listener(tab);
  else pending = tab;
}

/** The Home screen listens for requested tabs; one asked for before it listened arrives at once. */
export function onTabRequest(fn: (tab: TabId) => void): () => void {
  listener = fn;
  if (pending) {
    const t = pending;
    pending = null;
    fn(t);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}

const STRIP_TOP = 8;
const PILL_H = 58;
const stripBottom = (bottomInset: number) => Math.max(bottomInset - 8, 8);

/** Total height of the tab bar strip for a given bottom safe-area inset. */
export const tabBarHeight = (bottomInset: number) => STRIP_TOP + PILL_H + stripBottom(bottomInset);

/**
 * Floating pill tab bar on a black strip.
 *
 * `faded`: the pill fades out (with the double take's chrome, at its pace) and
 * takes no touches until it's back. The strip keeps its place, so nothing
 * above it moves.
 */
export function TabBar({ tab, onTab, faded = false }: { tab: TabId; onTab: (t: TabId) => void; faded?: boolean }) {
  const insets = useSafeAreaInsets();
  const shown = useFadeProgress(!faded, faded ? 180 : 320);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <View style={[styles.strip, { paddingBottom: stripBottom(insets.bottom) }]} pointerEvents={faded ? 'none' : 'auto'} testID="tab-bar">
      <Reanimated.View style={[styles.pill, ownLayer, fade]}>
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
      </Reanimated.View>
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
  // Four tabs fit a 320pt-wide phone: each shrinks below 84 when it must.
  tab: { height: 44, flex: 1, maxWidth: 84, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#3d3d3d' },
});
