import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCount, type Clip } from '@/data/clips';
import type { ProfileTab } from '@/social/nav';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const PROFILE_TABS: { id: ProfileTab; label: string; icon: IconName; iconActive: IconName }[] = [
  { id: 'reposts', label: 'Reposts', icon: 'repeat-outline', iconActive: 'repeat' },
  { id: 'shared', label: 'Shared', icon: 'paper-plane-outline', iconActive: 'paper-plane' },
  { id: 'liked', label: 'Liked', icon: 'heart-outline', iconActive: 'heart' },
  { id: 'saved', label: 'Saved', icon: 'bookmark-outline', iconActive: 'bookmark' },
];

const EMPTY: Record<ProfileTab, { title: string; text: string }> = {
  reposts: { title: 'No reposts yet', text: 'Takes you repost show up here for your followers.' },
  shared: { title: 'Nothing shared yet', text: 'Takes you send to friends show up here.' },
  liked: { title: 'No likes yet', text: 'Double-tap a Take you love and it lands here.' },
  saved: {
    title: 'Save for later',
    text: "Save Takes you want to watch again. Only you can see what you've saved.",
  },
};

export function ProfileTabs({ tab, onTab }: { tab: ProfileTab; onTab: (t: ProfileTab) => void }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {PROFILE_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Pressable
            key={t.id}
            onPress={() => onTab(t.id)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
          >
            <Ionicons name={on ? t.iconActive : t.icon} size={24} color={on ? '#fff' : '#8e8e8e'} />
            <View style={[styles.underline, on && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyTab({ tab }: { tab: ProfileTab }) {
  const icon = PROFILE_TABS.find((t) => t.id === tab)!.icon;
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCircle}>
        <Ionicons name={icon} size={34} color="#fff" />
      </View>
      <Text style={styles.emptyTitle}>{EMPTY[tab].title}</Text>
      <Text style={styles.emptyText}>{EMPTY[tab].text}</Text>
    </View>
  );
}

export const Tile = memo(function Tile({
  clip,
  width,
  liked,
  showHeart,
  onPress,
}: {
  clip: Clip;
  width: number;
  liked: boolean;
  showHeart: boolean;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(clip.id)}
      style={({ pressed }) => [styles.tile, { width, height: Math.round((width * 16) / 9) }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={`Play Take by ${clip.author}`}
    >
      <Image source={clip.poster} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={styles.tileMeta} pointerEvents="none">
        <Ionicons name={showHeart ? 'heart' : 'play'} size={13} color="#fff" style={styles.shadow} />
        <Text style={[styles.tileCount, styles.shadow]}>{formatCount(clip.likes + (liked ? 1 : 0))}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
    marginTop: 14,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 10 },
  underline: { height: 2, width: '70%', backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: '#fff' },
  empty: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, gap: 8 },
  emptyCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: '#a8a8a8', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  tile: { backgroundColor: '#1a1a1a', overflow: 'hidden' },
  tileMeta: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileCount: { color: '#fff', fontSize: 12, fontWeight: '600' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
