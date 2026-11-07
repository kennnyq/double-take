import { useMemo, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Clip } from '@/data/clips';
import { FRIENDS, filterFriends } from '@/data/friends';
import { useSocialActions } from '@/social/actions';
import { clipLink } from '@/social/me';
import { hasClip } from '@/social/reducer';
import { useSocial } from '@/social/store';
import { Avatar } from '@/ui/Avatar';
import { BottomSheet, useKeyboardVisible } from '@/ui/BottomSheet';
import { useToast } from '@/ui/Toast';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  clip: Clip;
  open: boolean;
  progress: Animated.Value;
  onRequestClose: () => void;
  onClosed: () => void;
}

/** "Send to" sheet: pick friends and send, or repost / copy link / system share / download. */
export function ShareSheet({ clip, open, progress, onRequestClose, onClosed }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const social = useSocial();
  const actions = useSocialActions();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const friends = useMemo(() => filterFriends(query, FRIENDS), [query]);
  const reposted = hasClip(social.reposted, clip.id);
  const link = clipLink(clip.id);

  const toggleFriend = (handle: string) =>
    setSelected((s) => (s.includes(handle) ? s.filter((h) => h !== handle) : [...s, handle]));

  const send = () => {
    actions.markSent(clip, selected.length);
    onRequestClose();
  };

  const copyLink = async () => {
    onRequestClose();
    try {
      await Clipboard.setStringAsync(link);
      toast.show({ icon: 'link', text: 'Link copied' });
    } catch {
      toast.show({ icon: 'alert-circle-outline', text: "Couldn't copy the link" });
    }
  };

  const shareTo = async () => {
    onRequestClose();
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { url: link } : { message: link },
        { dialogTitle: 'Share this Take' },
      );
      if (result.action === Share.sharedAction) actions.markSent(clip, 1);
    } catch {
      // Dismissed or unavailable: nothing to do.
    }
  };

  return (
    <BottomSheet
      open={open}
      progress={progress}
      onRequestClose={onRequestClose}
      onClosed={onClosed}
      accessibilityLabel="Send to"
      header={<Text style={styles.title}>Send to</Text>}
    >
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color="#8e8e8e" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor="#8e8e8e"
            style={styles.searchInput}
            keyboardAppearance="dark"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search friends"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color="#8e8e8e" />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.grid}
        contentContainerStyle={styles.gridContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {friends.map((f) => {
          const on = selected.includes(f.handle);
          return (
            <Pressable
              key={f.handle}
              onPress={() => toggleFriend(f.handle)}
              style={({ pressed }) => [styles.friend, pressed && { opacity: 0.7 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={f.name}
            >
              <View style={[styles.ring, on && styles.ringOn]}>
                <Avatar name={f.name} size={64} />
                {on ? (
                  <View style={styles.check}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                ) : f.active ? (
                  <View style={styles.activity}>
                    <Text style={styles.activityText}>{f.active}</Text>
                  </View>
                ) : f.online ? (
                  <View style={styles.online} />
                ) : null}
              </View>
              <Text style={styles.name} numberOfLines={2}>
                {f.name}
              </Text>
            </Pressable>
          );
        })}
        {friends.length === 0 && <Text style={styles.noResults}>No one matches “{query.trim()}”</Text>}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: (keyboard ? 0 : insets.bottom) + 10 }]}>
        {selected.length > 0 ? (
          <>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Write a message…"
              placeholderTextColor="#8e8e8e"
              style={styles.message}
              keyboardAppearance="dark"
              accessibilityLabel="Message"
            />
            <Pressable
              onPress={send}
              style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
            >
              <Text style={styles.sendText}>{selected.length > 1 ? 'Send separately' : 'Send'}</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.actions}>
            <RoundAction
              icon="repeat"
              label={reposted ? 'Reposted' : 'Repost'}
              active={reposted}
              onPress={() => actions.toggleRepost(clip)}
            />
            <RoundAction icon="link-outline" label="Copy link" onPress={copyLink} />
            <RoundAction icon="share-outline" label="Share to…" onPress={shareTo} />
            <RoundAction
              icon="download-outline"
              label="Download"
              onPress={() => {
                onRequestClose();
                toast.show({ icon: 'download-outline', text: 'Downloads coming soon' });
              }}
            />
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

function RoundAction({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
    >
      <View style={[styles.actionCircle, active && styles.actionCircleOn]}>
        <Ionicons name={icon} size={24} color={active ? '#0f0f0f' : '#fff'} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { color: '#f5f5f5', fontSize: 16, fontWeight: '700', textAlign: 'center', paddingBottom: 10 },
  searchRow: { paddingHorizontal: 14, paddingBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#2c2c2e',
  },
  searchInput: { flex: 1, color: '#f5f5f5', fontSize: 15, paddingVertical: 0 },
  grid: { flex: 1 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 12 },
  friend: { width: '33.333%', alignItems: 'center', paddingVertical: 8, gap: 6 },
  ring: { padding: 3, borderRadius: 38, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: '#4c8dff' },
  check: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4c8dff',
    borderWidth: 2,
    borderColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activity: {
    position: 'absolute',
    right: -4,
    bottom: 0,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: '#1f3d26',
    borderWidth: 2,
    borderColor: '#1c1c1e',
  },
  activityText: { color: '#5fd17a', fontSize: 10, fontWeight: '700' },
  online: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3ccf5e',
    borderWidth: 2,
    borderColor: '#1c1c1e',
  },
  name: { color: '#f5f5f5', fontSize: 12, textAlign: 'center', paddingHorizontal: 4 },
  noResults: { width: '100%', color: '#8e8e8e', fontSize: 14, textAlign: 'center', paddingTop: 24 },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  message: {
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#2c2c2e',
    color: '#f5f5f5',
    fontSize: 15,
  },
  sendBtn: { height: 44, borderRadius: 12, backgroundColor: '#4c8dff', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 6, width: 76 },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleOn: { backgroundColor: '#fff' },
  actionLabel: { color: '#e5e5e5', fontSize: 12 },
});
