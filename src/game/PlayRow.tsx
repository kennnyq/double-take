import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { loadInitialClips } from '@/data/feed';
import { closeSettings } from '@/settings/store';
import { themed, usePalette } from '@/ui/theme';
import { GAME } from './config';
import { deckPlayable } from './deck';
// Registers Dev settings → Game; Settings is always in the bundle.
import './devSection';
import { useGameHistory } from './store';

/**
 * Whether the round can be offered. Production builds wait for enough clips of
 * both kinds (a deck of only AI clips makes it trivial); dev builds always
 * offer it, so it can be tried before then.
 */
function usePlayable(): boolean {
  const [playable, setPlayable] = useState(__DEV__);
  useEffect(() => {
    if (__DEV__) return;
    let live = true;
    loadInitialClips().then((clips) => live && setPlayable(deckPlayable(clips)));
    return () => {
      live = false;
    };
  }, []);
  return playable;
}

/** Starts a timed round. On desktop the Settings dialog fades out as the round opens. */
export function startRound(desktop: boolean) {
  if (desktop) closeSettings();
  router.push('/game');
}

/** Settings → Play: the timed round, with the best score so far. */
export function PlayRow({ wide }: { wide: boolean }) {
  const playable = usePlayable();
  const { best } = useGameHistory();
  const c = usePalette();
  const tint = useTint();
  const seconds = Math.round(GAME.roundMs / 1000);
  const how = wide ? 'double-click: AI · scroll: skip' : 'double tap: AI · swipe: skip';
  return (
    <Pressable
      onPress={() => startRound(wide)}
      disabled={!playable}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && playable && styles.rowPressed,
        !playable && styles.disabled,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !playable }}
      accessibilityLabel={`Timed guessing. ${playable ? `${seconds} seconds. ${how}` : 'Needs real clips'}`}
    >
      <View style={[styles.icon, tint.icon]}>
        <Ionicons name="timer-outline" size={18} color={c.onAccent} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, tint.text]}>Timed guessing</Text>
        <Text style={[styles.desc, tint.dim]}>{playable ? `${seconds} s · ${how}` : 'Needs real clips'}</Text>
      </View>
      {best > 0 && (
        <View style={[styles.chip, tint.chip]} accessibilityLabel={`Best ${best}`}>
          <Ionicons name="trophy-outline" size={12} color={c.text} />
          <Text style={[styles.chipText, tint.text]}>{best}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={c.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  disabled: { opacity: 0.5 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 17 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12 },
  chipText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

const useTint = themed((c) => ({
  icon: { backgroundColor: c.accent },
  chip: { backgroundColor: c.surface },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
