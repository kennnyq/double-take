import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useGuestChosen, continueAsGuest } from '@/auth/guest';
import { openSignIn, signOutToChoice } from '@/auth/gate';
import { useAuth, useMe } from '@/auth/store';
import { useMyNote } from './note';
import { NoteEditor } from './NoteEditor';
import { supabase } from '@/auth/supabase';
import { openSettings } from '@/settings/store';
import { ME, profileLink } from '@/social/me';
import { useAppNav, type ProfileTab } from '@/social/nav';
import type { ClipEntry, SocialState } from '@/social/reducer';
import { useSocial } from '@/social/store';
import { Avatar } from '@/ui/Avatar';
import { useToast } from '@/ui/Toast';
import { themed } from '@/ui/theme';
import { EmptyTab, ProfileTabs, Tile } from './ProfileGrid';

const LIST_FOR: Record<ProfileTab, keyof Pick<SocialState, 'reposted' | 'sent' | 'liked' | 'saved'>> = {
  reposts: 'reposted',
  shared: 'sent',
  liked: 'liked',
  saved: 'saved',
};

const GAP = 2;
const MAX_WIDTH = 720;

/** The "You" tab: header, stats, and grids of reposted / shared / liked / saved Takes. */
export function Profile({ tab, onTab }: { tab: ProfileTab; onTab: (t: ProfileTab) => void }) {
  const { status } = useAuth();
  const guest = useGuestChosen();
  // A guest who chose to continue gets the full profile, kept on this device.
  if ((status === 'guest' && !guest) || status === 'loading') return <GuestProfile loading={status === 'loading'} />;
  return <MemberProfile tab={tab} onTab={onTab} />;
}

/** How many members follow this handle (public), or null while unknown. Guests have none. */
function useFollowers(handle: string, local: boolean, guest: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (local || guest || !supabase) return;
    let live = true;
    supabase
      .from('follows')
      .select('user_id', { count: 'exact', head: true })
      .eq('author_handle', handle)
      .then(({ count }) => live && setN(count ?? 0));
    return () => {
      live = false;
    };
  }, [handle, local, guest]);
  return local ? ME.followers : guest ? 0 : n;
}

function MemberProfile({ tab, onTab }: { tab: ProfileTab; onTab: (t: ProfileTab) => void }) {
  const social = useSocial();
  const { status } = useAuth();
  const local = status === 'local';
  // A guest's profile lives on this device: no followers, nothing to share.
  const guest = status === 'guest';
  const me = useMe();
  const followers = useFollowers(me.handle, local, guest);
  const [menu, setMenu] = useState(false);
  const note = useMyNote();
  const [noteOpen, setNoteOpen] = useState(false);
  const nav = useAppNav();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const contentW = Math.min(winW, MAX_WIDTH);
  const tileW = Math.floor((contentW - GAP * 2) / 3);

  const entries = social[LIST_FOR[tab]];
  const liked = useMemo(() => new Set(social.liked.map((e) => e.id)), [social.liked]);
  const openClip = useCallback((id: string) => nav.openClip(id), [nav]);

  const soon = (what: string) => toast.show({ icon: 'construct-outline', text: `${what} coming soon` });
  const shareProfile = async () => {
    try {
      await Clipboard.setStringAsync(profileLink(me.handle));
      toast.show({ icon: 'link', text: 'Profile link copied' });
    } catch {
      soon('Sharing profiles is');
    }
  };

  const header = (
    <View>
      <View style={styles.headRow}>
        <View style={styles.avatarWrap}>
          <Avatar name={me.handle} size={86} />
          <Pressable
            onPress={() => setNoteOpen(true)}
            hitSlop={6}
            style={({ pressed }) => [styles.note, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={note ? `Note: ${note}. Edit` : 'Add a note'}
          >
            <Text style={[styles.noteText, note !== null && styles.noteTextSet]} numberOfLines={2}>
              {note ?? 'Note…'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.headInfo}>
          <Text style={styles.name}>{me.name}</Text>
          <View style={styles.stats}>
            <Stat n={0} label="posts" />
            <Stat n={followers ?? 0} label="followers" />
            <Stat n={local ? ME.following : social.followed.length} label="following" />
          </View>
        </View>
      </View>
      <View style={styles.buttons}>
        {guest ? (
          <ProfileButton label="Sign in to save across devices" onPress={() => openSignIn('Sign in to save across devices')} />
        ) : (
          <>
            <ProfileButton label="Edit profile" onPress={() => soon('Editing your profile is')} />
            <ProfileButton label="Share profile" onPress={shareProfile} />
          </>
        )}
      </View>
      <ProfileTabs tab={tab} onTab={onTab} />
      {tab === 'saved' && entries.length > 0 && (
        <View style={styles.privateNote}>
          <Ionicons name="lock-closed-outline" size={13} color="#a8a8a8" />
          <Text style={styles.privateText}>Only you can see what you&apos;ve saved</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={nav.openCreate}
          hitSlop={8}
          accessibilityLabel="Upload"
          style={styles.topBtn}
        >
          <Ionicons name="cloud-upload-outline" size={27} color="#fff" />
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {me.handle}
          </Text>
        </View>
        <Pressable onPress={() => setMenu((m) => !m)} hitSlop={8} accessibilityLabel="Menu" style={styles.topBtn}>
          <Ionicons name="menu" size={28} color="#fff" />
        </Pressable>
      </View>
      {menu && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} accessibilityLabel="Close menu" />
          <View style={[styles.menu, { top: insets.top + 50 }]} role="menu">
            <MenuItem
              icon="settings-outline"
              label="Settings"
              onPress={() => {
                setMenu(false);
                openSettings();
              }}
            />
            {guest ? (
              <MenuItem
                icon="log-in-outline"
                label="Sign in"
                onPress={() => {
                  setMenu(false);
                  openSignIn('Sign in to save across devices');
                }}
              />
            ) : (
              !local && (
                <MenuItem
                  icon="log-out-outline"
                  label="Sign out"
                  tone="danger"
                  onPress={() => {
                    setMenu(false);
                    signOutToChoice();
                  }}
                />
              )
            )}
          </View>
        </>
      )}
      <FlatList<ClipEntry>
        key={tab}
        style={[styles.list, { width: contentW }]}
        data={entries}
        keyExtractor={(e) => e.id}
        numColumns={3}
        columnWrapperStyle={styles.column}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyTab tab={tab} />}
        renderItem={({ item }) => (
          <Tile clip={item.clip} width={tileW} liked={liked.has(item.id)} showHeart={tab === 'liked'} onPress={openClip} />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      <NoteEditor open={noteOpen} note={note} handle={me.handle} onClose={() => setNoteOpen(false)} />
    </View>
  );
}

/** Signed out: a prompt to sign in, instead of empty grids. */
function GuestProfile({ loading }: { loading: boolean }) {
  const insets = useSafeAreaInsets();
  const tint = useTint();
  return (
    <View style={[styles.root, styles.guest, { paddingTop: insets.top }]}>
      {!loading && (
        <View style={styles.guestBody}>
          <View style={styles.guestIcon}>
            <Ionicons name="person-outline" size={40} color="#fff" />
          </View>
          <Text style={styles.guestTitle}>Your profile</Text>
          <Text style={styles.guestText}>Sign in to keep your likes, saves and reposts, and pick up where you left off on any device.</Text>
          <Pressable
            onPress={() => openSignIn()}
            style={({ pressed }) => [styles.guestButton, tint.guestButton, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.guestButtonText, tint.guestButtonText]}>Sign in or sign up</Text>
          </Pressable>
          <Pressable onPress={continueAsGuest} style={({ pressed }) => [styles.guestSecondary, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={styles.guestSecondaryText}>Continue as guest</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function MenuItem({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.6 }]} role="menuitem">
      <Ionicons name={icon} size={20} color={tone ? '#ff6961' : '#fff'} />
      <Text style={[styles.menuText, tone && { color: '#ff6961' }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n.toLocaleString('en-US')}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center' },
  topBar: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingBottom: 24 },
  column: { gap: GAP, marginBottom: GAP },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 22, gap: 20 },
  avatarWrap: { width: 92, alignItems: 'center' },
  note: {
    position: 'absolute',
    top: -20,
    left: -6,
    maxWidth: 96,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#2a2a2a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  noteText: { color: '#a8a8a8', fontSize: 12 },
  noteTextSet: { color: '#fff' },
  headInfo: { flex: 1, gap: 8 },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingRight: 8 },
  stat: { alignItems: 'flex-start' },
  statN: { color: '#fff', fontSize: 17, fontWeight: '700' },
  statLabel: { color: '#e5e5e5', fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 18 },
  button: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  privateNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  privateText: { color: '#a8a8a8', fontSize: 13 },
  menu: {
    position: 'absolute',
    right: 12,
    minWidth: 180,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#262626',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 10,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  menuText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  guest: { justifyContent: 'center' },
  guestBody: { alignItems: 'center', gap: 12, paddingHorizontal: 32, maxWidth: 420 },
  guestIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  guestSecondary: { height: 46, paddingHorizontal: 28, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3a3a3c' },
  guestSecondaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  guestTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  guestText: { color: '#a8a8a8', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  guestButton: {
    marginTop: 10,
    height: 46,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestButtonText: { fontSize: 16, fontWeight: '700' },
});

const useTint = themed((c) => ({
  guestButton: { backgroundColor: c.accent },
  guestButtonText: { color: c.onAccent },
}));
