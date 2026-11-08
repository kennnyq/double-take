import type { ComponentType } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { verdictWhy } from '@/data/remote';
import { VerdictBadge } from '@/feed/VerdictBadge';
import { themed, usePalette } from '@/ui/theme';
import type { Guess } from './round';

/**
 * Why a missed clip is what it is, over its replay. This is the one place the
 * review screen asks for an explanation, so the double take walkthrough
 * (TellOverlay: spotlight, info card, scrubs) can replace the plain card by
 * changing `MISS_EXPLAINER` alone, once that flow is on main.
 */
export interface ExplainerProps {
  clip: Clip;
  guess: Guess;
  /** What the viewer did against what it was, e.g. "You skipped · AI". */
  label: string;
  /** The replay's player, already holding the clip: the walkthrough pauses, scrubs and slows it. */
  player: VideoPlayer;
  /** Space the explainer must leave clear at the top (the review's controls). */
  top: number;
  bottom: number;
}

export type MissExplainer = ComponentType<ExplainerProps>;

/** For now: the verdict, the line that backs it, and the source. */
export function PlainExplainer({ clip, guess, label, bottom }: ExplainerProps) {
  const c = usePalette();
  const tint = useTint();
  const why = verdictWhy(clip);
  const truth = clip.verdict ?? guess.truth;
  return (
    <View style={[styles.wrap, { paddingBottom: bottom + 16 }]} pointerEvents="box-none">
      <View style={[styles.card, tint.card]} testID="miss-explanation">
        <View style={styles.head}>
          <VerdictBadge verdict={truth} />
          <Text style={[styles.you, tint.dim]}>{label}</Text>
        </View>
        <Text style={[styles.title, tint.text]}>{truth === 'ai' ? 'Why it was AI' : 'Why it was real'}</Text>
        {why ? <Text style={[styles.body, tint.text]}>{why}</Text> : null}
        {clip.sourceUrl ? (
          <Pressable
            onPress={() => Linking.openURL(clip.sourceUrl!).catch(() => {})}
            style={({ pressed }) => [styles.source, pressed && styles.pressed]}
            accessibilityRole="link"
          >
            <Ionicons name="open-outline" size={14} color={c.link} />
            <Text style={[styles.sourceText, tint.link]}>Source</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The explanation the review shows. Swap for the double take walkthrough once it's on main. */
export const MISS_EXPLAINER: MissExplainer = PlainExplainer;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  card: { borderRadius: 18, padding: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  you: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4 },
  sourceText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});

const useTint = themed((c) => ({
  card: { backgroundColor: c.surface },
  text: { color: c.text },
  dim: { color: c.textDim },
  link: { color: c.link },
}));
