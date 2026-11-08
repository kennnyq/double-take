import { useState, type ComponentProps } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_INFO, type SkillCategory } from '@/skills/categories';
import { SKILL_ICONS } from '@/skills/insights';
import { themed, usePalette } from '@/ui/theme';
import { lerp, useEased } from './motion';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The untimed game's score: points, clips judged, and a ✓ / ✕ that eases in
 * while `result` is set and away when it's cleared (keeping its glyph as it
 * fades). Presentational, so the landing can draw the same pill.
 */
export function ScorePill({ score, judged, result = null, focus }: { score: number; judged: number; result?: 'right' | 'wrong' | null; focus?: SkillCategory }) {
  const tint = useTint();
  const c = usePalette();
  // The glyph stays as it was while it fades out.
  const [shown, setShown] = useState(result);
  if (result && result !== shown) setShown(result);
  const on = useEased(result ? 1 : 0, 240);
  const right = shown === 'right';
  return (
    <View style={[styles.score, tint.pill]} accessibilityLabel={`Score ${score}, ${judged} judged`} testID="game-score-live">
      <Text style={[styles.scoreText, tint.text]}>{score}</Text>
      <View style={styles.part}>
        <Ionicons name="layers-outline" size={13} color={c.textDim} />
        <Text style={[styles.judgedText, tint.dim]}>{judged}</Text>
      </View>
      <Animated.View
        style={[styles.result, { backgroundColor: right ? c.correct : c.incorrect, opacity: on, transform: [{ scale: lerp(on, [0, 1], [0.6, 1]) }] }]}
        accessibilityLabel={result ? (right ? 'Right' : 'Wrong') : undefined}
      >
        <Ionicons name={right ? 'checkmark' : 'close'} size={14} color={c.onAccent} />
      </Animated.View>
      {focus && (
        <View style={styles.part} accessibilityLabel={`Practising ${CATEGORY_INFO[focus].label}`}>
          <Ionicons name={SKILL_ICONS[focus] as IconName} size={13} color={c.textDim} />
        </View>
      )}
    </View>
  );
}

/** A clip looked back at: what it was, and whether you got it right. Presentational. */
export function ReviewPill({ truth, correct }: { truth: 'ai' | 'real'; correct: boolean }) {
  const tint = useTint();
  const c = usePalette();
  return (
    <View style={[styles.review, tint.pill]} testID="review-truth" accessibilityLabel={`It was ${truth === 'ai' ? 'AI' : 'real'}; you were ${correct ? 'right' : 'wrong'}`}>
      <Text style={[styles.reviewText, tint.text]}>{truth === 'ai' ? 'AI' : 'Real'}</Text>
      <Ionicons name={correct ? 'checkmark' : 'close'} size={14} color={correct ? c.correct : c.incorrect} />
    </View>
  );
}

const styles = StyleSheet.create({
  score: { height: 34, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreText: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  part: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  judgedText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  result: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  review: { height: 28, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewText: { fontSize: 13, fontWeight: '800' },
});

const useTint = themed((c) => ({
  pill: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentSoft },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
