import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { GAME_TAB_LABEL } from '@/game/config';
import * as Haptics from 'expo-haptics';
import { ownLayer } from '@/feed/layer';
import { useFadeProgress } from '@/feed/motion';
// The Game tab's dev options (Dev settings → Game, with the timed demo round).
import '@/game/devSection';

export type TabId = 'home' | 'game' | 'skills' | 'create' | 'you' | 'settings';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The app's main features, in order: the feed (Home), the game and your
 * skills (a pair), Upload (its id is still 'create'), and You. Settings is reached from You (and is
 * still a route, below).
 */
export const TABS: { id: TabId; label: string; icon: IconName; iconActive: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { id: 'game', label: GAME_TAB_LABEL, icon: 'game-controller-outline', iconActive: 'game-controller' },
  { id: 'skills', label: 'Skills', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { id: 'create', label: 'Upload', icon: 'cloud-upload-outline', iconActive: 'cloud-upload' },
  { id: 'you', label: 'You', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

/**
 * Tabs that are routes of their own, pushed over Home without animation (the
 * others are views of the Home screen). Every tab handler goes through this.
 */
export const TAB_ROUTES = {
  game: '/play',
  skills: '/skills',
  settings: '/settings',
} as const satisfies Partial<Record<TabId, Href>>;

export function tabRoute(tab: TabId): (typeof TAB_ROUTES)[keyof typeof TAB_ROUTES] | null {
  return (TAB_ROUTES as Partial<Record<TabId, (typeof TAB_ROUTES)[keyof typeof TAB_ROUTES]>>)[tab] ?? null;
}

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
              // Browsers: React Native Web doesn't carry `selected` over for tabs.
              aria-selected={on}
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
