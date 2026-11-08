import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { themed, usePalette } from '@/ui/theme';
import { useFrame } from '@/game/frame';
import { ResolveText } from '@/game/ResolveText';
import { CATEGORY_INFO, SKILL_CATEGORIES } from './categories';
import { SkillBars } from './SkillBars';
import { useSkillState } from './store';
import { useScorableCategories } from './useScorable';

/** "Your skills": the general score and one bar per category, from every round on this device. */
export function SkillsView() {
  const frame = useFrame();
  const state = useSkillState();
  const { categories, coverage } = useScorableCategories();
  const tint = useTint();
  const c = usePalette();
  const width = Math.min(frame.width, 560) - 32;
  const unscored = SKILL_CATEGORIES.filter((c) => !categories.includes(c) && coverage[c] > 0);
  return (
    <ScrollView style={[styles.root, tint.root]} contentContainerStyle={[styles.body, { paddingTop: (frame.desktop ? 0 : frame.top) + 28 }]}>
      <View style={{ width, gap: 18 }}>
        <View style={styles.head}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            style={({ pressed }) => [styles.back, tint.card, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={20} color={c.text} />
          </Pressable>
          <ResolveText on style={[styles.title, tint.text]}>
            Your skills
          </ResolveText>
        </View>
        <View style={[styles.card, tint.card]}>
          <SkillBars skills={state.skills} categories={categories} delay={150} />
        </View>
        <Text style={[styles.note, tint.dim]}>
          {state.answers} answers · {state.rounds} rounds
          {unscored.length ? ` · not enough clips yet: ${unscored.map((c) => CATEGORY_INFO[c].label).join(', ')}` : ''}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 28 },
  title: { fontSize: 28, fontWeight: '800' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  card: { borderRadius: 18, padding: 18 },
  note: { fontSize: 12.5, lineHeight: 17 },
});

const useTint = themed((c) => ({
  root: { backgroundColor: c.bg },
  card: { backgroundColor: c.surface },
  text: { color: c.text },
  dim: { color: c.textDim },
}));
