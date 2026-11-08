import { forwardRef, type ComponentProps, type ComponentRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Clip } from '@/data/clips';
import { themed, usePalette } from '@/ui/theme';
import type { DesignId } from '../designs';
import { lerp, type AnimNum } from '../motion';
import type { Verdict } from '../round';

export type RevealDesign = DesignId<'reveal'>;
export type GridDesign = DesignId<'grid'>;

/** One clip of the round on the results grid. */
export interface ResultEntry {
  clipId: string;
  clip: Clip;
  truth: Verdict;
  /** What the viewer did; undefined for the clip on screen when time ran out. */
  guess?: Verdict;
  correct?: boolean;
}

/** What the viewer did against what the clip was, in a few words. */
export function entryLabel(e: Pick<ResultEntry, 'guess' | 'truth'>): string {
  const truth = e.truth === 'ai' ? 'AI' : 'Real';
  if (!e.guess) return `Not judged · ${truth}`;
  return e.guess === 'ai' ? `You: AI · ${truth}` : `You skipped · ${truth}`;
}

interface Props {
  entry: ResultEntry;
  width: number;
  reveal: RevealDesign;
  grid: GridDesign;
  /** 0..1: this tile's own reveal. */
  t: AnimNum;
  /** 0..1: its right/wrong cue easing in, after the reveal. */
  cue: AnimNum;
  /** Hidden while it's open full size (its place stays). */
  hidden?: boolean;
  onPress?: () => void;
}

const RADIUS = 12;

/**
 * A results tile: the clip's poster, a green or red cue for right or wrong
 * with a ✓ or ✕ (never colour alone), and an AI or Real chip told apart by
 * fill, icon and word. It reveals itself in the chosen design as `t` runs.
 */
export type TileHandle = ComponentRef<typeof View>;

export const ResultTile = forwardRef<TileHandle, Props>(function ResultTile({ entry, width, reveal, grid, t, cue, hidden, onPress }, ref) {
  const c = usePalette();
  const tint = useTint();
  const height = Math.round((width * 16) / 9);
  const judged = entry.correct !== undefined;
  const color = !judged ? c.textDim : entry.correct ? c.correct : c.incorrect;
  const verdictWord = entry.correct === undefined ? 'Not judged' : entry.correct ? 'Right' : 'Wrong';
  const label = `${verdictWord} · ${entry.truth === 'ai' ? 'AI' : 'Real'}. ${entryLabel(entry)}`;

  // ---- the reveal ----
  let outer: object = {};
  let face: object = {};
  let back: React.ReactNode = null;
  let sweep: React.ReactNode = null;
  if (reveal === 'settle') {
    outer = {
      opacity: lerp(t, [0, 0.45], [0, 1]),
      transform: [{ translateY: lerp(t, [0, 0.3, 0.6, 1], [22, 8, 2, 0]) }, { scale: lerp(t, [0, 0.6, 1], [0.92, 0.99, 1]) }],
    };
  } else if (reveal === 'flip') {
    // Two faces, each turning through its half; the swap happens edge-on, so it never shows.
    face = { opacity: lerp(t, [0.499, 0.5], [0, 1]), transform: [{ perspective: 800 }, { rotateY: lerp(t, [0.5, 0.8, 1], ['-90deg', '-12deg', '0deg']) }] };
    back = (
      <Animated.View
        style={[
          styles.face,
          tint.back,
          { opacity: lerp(t, [0.499, 0.5], [1, 0]), transform: [{ perspective: 800 }, { rotateY: lerp(t, [0, 0.5], ['0deg', '90deg']) }] },
        ]}
      >
        <Ionicons name="help" size={Math.round(width * 0.3)} color={c.textDim} />
      </Animated.View>
    );
  } else {
    // Sweep: dimmed from the start; the light passing over lights it up.
    outer = { opacity: lerp(t, [0, 0.6], [0.28, 1]), transform: [{ scale: lerp(t, [0, 0.45, 1], [1, 1.05, 1]) }] };
    sweep = (
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: lerp(t, [0, 0.2, 0.8, 1], [0, 1, 1, 0]), transform: [{ translateX: lerp(t, [0, 1], [-width, width]) }] }]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.45)', 'transparent']}
          start={{ x: 0, y: 0.3 }}
          end={{ x: 1, y: 0.7 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    );
  }

  const glyph = (size: number) => (
    <View style={[styles.glyph, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Ionicons name={!judged ? 'remove' : entry.correct ? 'checkmark' : 'close'} size={size * 0.68} color={c.onAccent} />
    </View>
  );
  const chip = <TruthChip truth={entry.truth} />;

  return (
    <Animated.View style={[{ width, height, opacity: hidden ? 0 : 1 }, outer]}>
      {/* The right/wrong cue behind or around the tile. */}
      {grid === 'glow' && judged && (
        <Animated.View pointerEvents="none" style={[styles.glow, { opacity: lerp(cue, [0, 1], [0, 0.9]) }, glowStyle(color)]} />
      )}
      <Pressable
        ref={ref}
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.tile, { width, height }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="result-tile"
      >
        <Animated.View style={[styles.face, tint.tile, face]}>
          <Image source={entry.clip.poster as ComponentProps<typeof Image>['source']} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
          {sweep}
          {grid !== 'strip' && <View style={styles.shade} pointerEvents="none" />}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: cue }]} pointerEvents="none">
            {grid === 'glow' && (
              <>
                <View style={styles.glyphTopLeft}>{glyph(22)}</View>
                <View style={styles.chipBottom}>{chip}</View>
              </>
            )}
            {grid === 'ring' && (
              <>
                <View style={[StyleSheet.absoluteFill, styles.ring, { borderColor: color }]} />
                <View style={styles.glyphTopRight}>{glyph(24)}</View>
                <View style={styles.chipBottom}>{chip}</View>
              </>
            )}
            {grid === 'strip' && (
              <View style={[styles.strip, { backgroundColor: color }]}>
                <Ionicons name={!judged ? 'remove' : entry.correct ? 'checkmark' : 'close'} size={15} color={c.onAccent} />
                <Ionicons name={entry.truth === 'ai' ? 'sparkles' : 'videocam'} size={12} color={c.onAccent} />
                <Text style={[styles.stripText, { color: c.onAccent }]}>{entry.truth === 'ai' ? 'AI' : 'Real'}</Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
        {back}
      </Pressable>
    </Animated.View>
  );
});

/** AI or Real, told apart without colour: a light filled chip with a sparkle, or dark glass with a camera. */
export function TruthChip({ truth }: { truth: Verdict }) {
  const c = usePalette();
  const tint = useTint();
  const ai = truth === 'ai';
  return (
    <View style={[styles.chip, ai ? tint.chipAi : tint.chipReal]}>
      <Ionicons name={ai ? 'sparkles' : 'videocam'} size={11} color={ai ? c.onAi : c.onReal} />
      <Text style={[styles.chipText, { color: ai ? c.onAi : c.onReal }]}>{ai ? 'AI' : 'Real'}</Text>
    </View>
  );
}

function glowStyle(color: string): object {
  return Platform.OS === 'web' ? { boxShadow: `0 0 18px 5px ${color}` } : { boxShadow: `0px 0px 16px 4px ${color}` };
}

const styles = StyleSheet.create({
  tile: { borderRadius: RADIUS },
  face: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: RADIUS, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' },
  glow: { position: 'absolute', left: 2, top: 2, right: 2, bottom: 2, borderRadius: RADIUS },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '35%', backgroundColor: 'rgba(0,0,0,0.35)' },
  glyph: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.35)' },
  glyphTopLeft: { position: 'absolute', left: 6, top: 6 },
  glyphTopRight: { position: 'absolute', right: 6, top: 6 },
  chipBottom: { position: 'absolute', left: 6, bottom: 6 },
  ring: { borderWidth: 3, borderRadius: RADIUS },
  strip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7 },
  stripText: { fontSize: 12, fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 20, borderRadius: 10 },
  chipText: { fontSize: 11, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});

const useTint = themed((c) => ({
  tile: { backgroundColor: c.surfaceRaised },
  back: { backgroundColor: c.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentSoft },
  chipAi: { backgroundColor: c.ai },
  chipReal: { backgroundColor: c.real, borderWidth: 1, borderColor: c.realBorder },
}));
