import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { themed } from '@/ui/theme';
import { lastRanking } from './feedOrder';

/** Dev settings: the feed's order from the last load, and why each clip is where it is. */
export function RankerReadout() {
  const ranked = useSyncExternalStore(lastRanking.subscribe, lastRanking.get, lastRanking.get);
  const tint = useTint();
  if (!ranked.length) return <Text style={[styles.empty, tint.dim]}>Turn the ranker on and reload to see the order it made.</Text>;
  return (
    <View style={styles.list} testID="ranker-readout">
      {ranked.slice(0, 12).map((r, i) => (
        <View key={r.clip.sourceId ?? r.clip.id} style={styles.row}>
          <Text style={[styles.pos, tint.dim]}>{i + 1}</Text>
          <View style={styles.body}>
            <Text style={[styles.title, tint.text]} numberOfLines={1}>
              @{r.clip.author} · {r.clip.verdict ?? '–'}
              {r.explored ? ' · exploring' : ''}
            </Text>
            <Text style={[styles.why, tint.dim]} numberOfLines={2}>
              {r.reasons
                .filter((x) => x.value)
                .slice(0, 3)
                .map((x) => `${x.value > 0 ? '+' : '−'}${Math.abs(x.value).toFixed(2)} ${x.why}`)
                .join(' · ') || 'no signals yet'}
            </Text>
          </View>
          <Text style={[styles.score, tint.text]}>{r.score.toFixed(2)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pos: { width: 18, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  body: { flex: 1, gap: 1 },
  title: { fontSize: 13, fontWeight: '600' },
  why: { fontSize: 11.5, lineHeight: 15 },
  score: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { fontSize: 13 },
});

const useTint = themed((c) => ({ text: { color: c.text }, dim: { color: c.textDim } }));
