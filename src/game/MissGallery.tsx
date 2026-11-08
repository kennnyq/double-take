import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { themed, usePalette } from '@/ui/theme';
import { NATIVE } from './motion';
import type { Guess } from './round';

/** What the viewer did against what the clip was. */
export function missLabel(g: Pick<Guess, 'guess' | 'truth'>): string {
  return g.guess === 'ai' ? `You: AI · ${g.truth === 'ai' ? 'AI' : 'Real'}` : `You skipped · ${g.truth === 'ai' ? 'AI' : 'Real'}`;
}

interface Props {
  misses: readonly Guess[];
  clips: ReadonlyMap<string, Clip>;
  columns: number;
  width: number;
  /** Opens the replay of a miss; tiles don't respond without it. */
  onOpen?: (clipId: string) => void;
}

const GAP = 8;

/** The round's wrong guesses as a poster grid; each tile eases in after the one before. */
export function MissGallery({ misses, clips, columns, width, onOpen }: Props) {
  const tile = Math.floor((width - GAP * (columns - 1)) / columns);
  const c = usePalette();
  const tint = useTint();
  if (misses.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="checkmark-done" size={28} color={c.text} />
        <Text style={[styles.emptyText, tint.dim]}>No misses</Text>
      </View>
    );
  }
  return (
    <View style={[styles.grid, { width }]} accessibilityLabel={`${misses.length} wrong guesses`}>
      {misses.map((g, i) => {
        const clip = clips.get(g.clipId);
        if (!clip) return null;
        return <Tile key={g.clipId} guess={g} clip={clip} size={tile} delay={120 + i * 60} onPress={onOpen && (() => onOpen(g.clipId))} />;
      })}
    </View>
  );
}

function Tile({ guess, clip, size, delay, onPress }: { guess: Guess; clip: Clip; size: number; delay: number; onPress?: () => void }) {
  const [t] = useState(() => new Animated.Value(0));
  const tint = useTint();
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration: 360, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [t, delay]);
  const label = missLabel(guess);
  return (
    <Animated.View
      style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.tile, { width: size, height: Math.round((size * 16) / 9) }, tint.tile, pressed && styles.pressed]}
        accessibilityRole="button"
        disabled={!onPress}
        accessibilityLabel={onPress ? `${label}. Replay` : label}
        testID="miss-tile"
      >
        <Image source={clip.poster as ComponentProps<typeof Image>['source']} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        <View style={styles.shade} />
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 12, overflow: 'hidden', justifyContent: 'flex-end' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: 'rgba(0,0,0,0.45)' },
  label: { color: '#fff', fontSize: 12, fontWeight: '700', padding: 8 },
  pressed: { opacity: 0.75 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  emptyText: { fontSize: 15, fontWeight: '600' },
});

const useTint = themed((c) => ({
  tile: { backgroundColor: c.surfaceRaised },
  dim: { color: c.textDim },
}));
