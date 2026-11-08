import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { requestTab } from '@/ui/TabBar';
import { themed, usePalette } from '@/ui/theme';
import { MissGallery } from './MissGallery';
import { NATIVE } from './motion';
import { wrongGuesses } from './score';
import { useGameHistory, type FinishedRound } from './store';

/** Leaves the game for the feed, which stayed mounted underneath at the same clip. */
export function backToFeed() {
  requestTab('home');
  router.dismissTo('/');
}

/** A number that counts up to `value` continuously. */
function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const v = new Animated.Value(0);
    const id = v.addListener(({ value: x }) => setShown(Math.round(x)));
    // Counting is text, not motion: driven on the JS side so the listener sees every frame.
    const a = Animated.timing(v, { toValue: value, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => {
      a.stop();
      v.removeListener(id);
    };
  }, [value, ms]);
  return shown;
}

/** After a round: the score, a few stats, and the clips it got wrong. */
export function Results({ done }: { done: FinishedRound }) {
  // TODO(feat/gesture-hint): call useBlockHints() from '@/onboarding/store' here once it lands on main.
  const { stats, round, newBest } = done;
  const { best } = useGameHistory();
  const score = useCountUp(stats.score);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const c = usePalette();
  const tint = useTint();
  const misses = wrongGuesses(round.guesses);
  const contentW = Math.min(width, 560) - 32;
  const columns = contentW >= 420 ? 4 : 3;

  // The header settles in; a new best glows in after the count.
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [enter]);
  const [glow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!newBest) return;
    Animated.timing(glow, { toValue: 1, duration: 700, delay: 800, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [glow, newBest]);

  return (
    <View style={[styles.root, tint.root]}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
        <Animated.View
          style={[
            styles.header,
            { width: contentW, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
          ]}
        >
          <Text style={[styles.score, tint.text]} accessibilityLabel={`Score ${stats.score}`} testID="game-score">
            {score}
          </Text>
          <View style={styles.bestWrap}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.glow, tint.glow, { opacity: glow }]} pointerEvents="none" />
            <View style={[styles.best, tint.chip]}>
              <Ionicons name="trophy-outline" size={13} color={c.text} />
              <Text style={[styles.bestText, tint.text]}>{newBest ? `New best ${best}` : `Best ${best}`}</Text>
            </View>
          </View>
          <View style={[styles.stats, tint.card]}>
            <Stat label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} />
            <Stat label="AI caught" value={`${stats.hits}/${stats.aiSeen}`} />
            <Stat label="False alarms" value={String(stats.falseAlarms)} />
          </View>
        </Animated.View>

        <View style={{ width: contentW }}>
          <MissGallery
            misses={misses}
            clips={done.clips}
            columns={columns}
            width={contentW}
          />
        </View>

        <View style={[styles.actions, { width: contentW }]}>
          <Pressable
            onPress={() => router.replace('/game')}
            style={({ pressed }) => [styles.primary, tint.primary, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, tint.primaryText]}>Play again</Text>
          </Pressable>
          <Pressable onPress={backToFeed} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={[styles.secondaryText, tint.dim]}>Back to feed</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const tint = useTint();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint.text]}>{value}</Text>
      <Text style={[styles.statLabel, tint.dim]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { alignItems: 'center', gap: 22, paddingHorizontal: 16 },
  header: { alignItems: 'center', gap: 12 },
  score: { fontSize: 84, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 92 },
  bestWrap: { alignItems: 'center', justifyContent: 'center' },
  glow: { borderRadius: 20, margin: -8, ...(Platform.OS === 'web' ? { filter: 'blur(10px)' } : null) },
  best: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: 15 },
  bestText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', alignSelf: 'stretch', borderRadius: 16, paddingVertical: 14 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, fontWeight: '600' },
  actions: { gap: 4 },
  primary: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '700' },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  chip: { backgroundColor: c.surfaceRaised },
  glow: { backgroundColor: c.accentSoft },
  primary: { backgroundColor: c.accent },
  primaryText: { color: c.onAccent },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
