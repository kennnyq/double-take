import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_PALETTE, LEGACY_PALETTES, PALETTES, PALETTE_IDS, setPalette, usePalette, type Palette, type PaletteId } from '@/ui/theme';
import { useDevTint } from './tint';

/**
 * Dev settings → Colors: switch the whole app between the palettes on trial,
 * live. The pick is kept on this device; builds without the dev tools always
 * use the default.
 */
export function PalettePicker() {
  const current = PALETTE_IDS.filter((id) => !LEGACY_PALETTES.includes(id));
  return (
    <View style={styles.wrap}>
      <View style={styles.group}>
        <Text style={styles.groupTitle}>Palette</Text>
        <Text style={styles.groupNote}>Applies everywhere at once. The dot marks the default the app ships with.</Text>
      </View>
      <PaletteList ids={current} label="Palette" />
      <View style={styles.group}>
        <Text style={styles.groupTitle}>Legacy</Text>
        <Text style={styles.groupNote}>The old look, to compare against.</Text>
      </View>
      <PaletteList ids={LEGACY_PALETTES} label="Legacy palette" />
    </View>
  );
}

function PaletteList({ ids, label }: { ids: readonly PaletteId[]; label: string }) {
  const live = usePalette();
  const tint = useDevTint();
  return (
    <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {ids.map((id) => {
        const p = PALETTES[id];
        const on = id === live.id;
        return (
          <Pressable
            key={id}
            onPress={() => setPalette(id)}
            style={({ pressed }) => [styles.item, on && { borderColor: live.accent }, pressed && !on && styles.dim]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${p.name}${id === DEFAULT_PALETTE ? ', default' : ''}`}
          >
            <Swatches p={p} />
            <View style={styles.text}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{p.name}</Text>
                {id === DEFAULT_PALETTE && <View style={styles.defaultDot} />}
              </View>
              <Text style={styles.blurb}>{p.blurb}</Text>
            </View>
            <View style={[styles.check, on && tint.chipOn]}>{on && <Ionicons name="checkmark" size={14} color={live.onAccent} />}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The palette at a glance: a control, the AI chip, the tell outline, a surface. */
function Swatches({ p }: { p: Palette }) {
  return (
    <View style={[styles.swatches, { backgroundColor: p.surface }]}>
      <View style={[styles.swatch, { backgroundColor: p.accent }]} />
      <View style={[styles.swatch, { backgroundColor: p.ai }]}>
        <Ionicons name="sparkles" size={10} color={p.onAi} />
      </View>
      <View style={[styles.swatch, styles.outline, { borderColor: p.tell }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  group: { gap: 6 },
  groupTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  groupNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dim: { opacity: 0.6 },
  swatches: { flexDirection: 'row', gap: 4, padding: 5, borderRadius: 10 },
  swatch: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 2.5, borderRadius: 5 },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: '#fff', fontSize: 14, fontWeight: '600' },
  defaultDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  blurb: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});
