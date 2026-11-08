import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFinishedRound } from '@/game/store';
import { requestTab } from '@/ui/TabBar';
import { themed } from '@/ui/theme';

/** After a round: the score. */
export default function ResultsScreen() {
  const done = useFinishedRound();
  const tint = useTint();
  // A reload loses the round: start a new one.
  if (!done) return <Redirect href="/game" />;
  return (
    <View style={[styles.root, tint.root]}>
      <Text style={[styles.score, tint.text]}>{done.stats.score}</Text>
      <Pressable
        onPress={() => {
          requestTab('home');
          router.dismissTo('/');
        }}
        accessibilityRole="button"
      >
        <Text style={tint.text}>Back to feed</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  score: { fontSize: 64, fontWeight: '900' },
});

const useTint = themed((c) => ({ root: { backgroundColor: c.bg }, text: { color: c.text } }));
