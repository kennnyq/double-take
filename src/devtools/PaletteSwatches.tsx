import { StyleSheet, Text, View } from 'react-native';
import { usePalette, type Palette } from '@/ui/theme';
import { useDevChrome } from './chrome';

const TOKENS: { key: keyof Palette; label: string; outline?: boolean }[] = [
  { key: 'accent', label: 'Accent' },
  { key: 'ai', label: 'AI' },
  { key: 'tell', label: 'Tell', outline: true },
  { key: 'real', label: 'Not AI' },
  { key: 'link', label: 'Link' },
  { key: 'focus', label: 'Focus', outline: true },
  { key: 'like', label: 'Like' },
  { key: 'danger', label: 'Danger' },
  { key: 'bg', label: 'Page' },
  { key: 'surface', label: 'Surface' },
  { key: 'surfaceRaised', label: 'Raised' },
  { key: 'textDim', label: 'Dim text' },
];

/** Dev settings → Colors: the live palette's colours at a glance. */
export function PaletteSwatches() {
  const p = usePalette();
  const chrome = useDevChrome();
  return (
    <View style={styles.grid}>
      {TOKENS.map((t) => (
        <View key={t.key} style={styles.cell}>
          <View
            style={[
              styles.swatch,
              t.outline ? { borderColor: p[t.key] as string, borderWidth: 2.5 } : { backgroundColor: p[t.key] as string },
            ]}
          />
          <Text style={[styles.label, chrome.dim]} numberOfLines={1}>
            {t.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  cell: { width: '25%', alignItems: 'center', gap: 4 },
  swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  label: { fontSize: 11, fontWeight: '600' },
});
