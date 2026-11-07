import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Verdict } from '@/data/clips';
import { openSettings } from '@/settings/store';
import { VERDICT_TEXT } from './feedMode';

/** "AI" / "Not AI" chip: on every clip in Auto label mode, and during a reveal. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const ai = verdict === 'ai';
  return (
    <View
      style={[styles.badge, ai ? styles.ai : styles.real]}
      accessibilityLabel={ai ? 'Verdict: AI-generated' : 'Verdict: not AI'}
      pointerEvents="none"
    >
      <Ionicons name={ai ? 'sparkles' : 'checkmark-circle'} size={13} color={ai ? '#111' : '#fff'} />
      <Text style={[styles.text, ai && styles.textAi]}>{VERDICT_TEXT[verdict]}</Text>
    </View>
  );
}

/** A filtered feed with nothing in it (e.g. "Only real content" before any real clips exist). */
export function FeedEmpty({ verdict }: { verdict: Verdict }) {
  const what = verdict === 'ai' ? 'AI' : 'real';
  return (
    <View style={styles.empty}>
      <Ionicons name={verdict === 'ai' ? 'sparkles-outline' : 'videocam-outline'} size={40} color="rgba(255,255,255,0.7)" />
      <Text style={styles.emptyTitle}>No {what} clips yet</Text>
      <Text style={styles.emptyBody}>
        {verdict === 'real'
          ? 'Every clip in the feed so far is AI-generated. Real footage is on the way.'
          : 'No clips in the feed are marked as AI yet.'}
      </Text>
      <Pressable
        onPress={openSettings}
        style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
      >
        <Ionicons name="settings-outline" size={16} color="#111" />
        <Text style={styles.emptyBtnText}>Change feed mode</Text>
      </Pressable>
    </View>
  );
}

const ACCENT = '#FFD60A';

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
  },
  ai: { backgroundColor: ACCENT },
  real: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  textAi: { color: '#111' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700', marginTop: 4 },
  emptyBody: { color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  emptyBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: ACCENT,
  },
  emptyBtnText: { color: '#111', fontSize: 15, fontWeight: '600' },
});
