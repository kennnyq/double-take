import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { themed, usePalette } from '@/ui/theme';
import { feedModeOptions } from './feedModeOptions';
import { gestureOptions } from './gesture';
import type { RevealGesture } from './settings';
import { appSettings, closeSettings, useAppSettings, useSettingsOpen } from './store';

/**
 * The Settings dialog on wide screens (desktop web), opened from the rail's
 * gear. Phones show the same content as the Settings tab (`src/app/settings.tsx`).
 * Changes save and apply as soon as they're picked.
 */
export function SettingsScreen() {
  const open = useSettingsOpen();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tint = useTint();
  const wide = width >= 760;

  return (
    <Modal
      visible={open}
      transparent
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={closeSettings}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.backdrop, wide ? styles.backdropWide : styles.backdropPhone]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSettings} accessibilityLabel="Close settings" />
        <View
          style={[styles.panel, tint.panel, wide ? styles.panelWide : [styles.panelPhone, { paddingBottom: insets.bottom + 12 }]]}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label="Settings"
        >
          {!wide && <View style={styles.grabber} />}
          <View style={styles.header}>
            <Text style={styles.title} role="heading">
              Settings
            </Text>
            <Pressable
              onPress={closeSettings}
              hitSlop={8}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          <SettingsContent wide={wide} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * The settings themselves, shared by the desktop dialog and the phone's
 * Settings tab. Every row writes the store at once; the feed reads it live.
 */
export function SettingsContent({ wide, style }: { wide: boolean; style?: StyleProp<ViewStyle> }) {
  const { feedMode, revealGesture } = useAppSettings();
  // The reveal's wording follows the gesture picked below.
  const options = feedModeOptions(revealGesture, wide);
  const gestures = gestureOptions(wide);
  const c = usePalette();
  const tint = useTint();
  return (
    <ScrollView style={style} contentContainerStyle={styles.body} bounces={false}>
      <Text style={styles.sectionTitle}>Feed mode</Text>
      <Text style={styles.sectionHint}>How the feed handles whether a clip is AI.</Text>
      <View style={[styles.group, tint.group]} role="radiogroup" aria-label="Feed mode">
        {options.map((o, i) => {
          const on = feedMode === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => appSettings.set('feedMode', o.id)}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.row,
                i > 0 && styles.rowDivider,
                (pressed || hovered) && styles.rowPressed,
              ]}
              role="radio"
              aria-checked={on}
              accessibilityLabel={`${o.title}. ${o.description}`}
            >
              <View style={[styles.icon, on && tint.iconOn]}>
                <Ionicons name={o.icon} size={18} color={on ? c.onAccent : '#fff'} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{o.title}</Text>
                <Text style={styles.rowDesc}>{o.description}</Text>
              </View>
              <View style={[styles.radio, on && tint.radioOn]}>{on && <View style={[styles.radioDot, tint.radioDot]} />}</View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, styles.sectionGap]}>Double take</Text>
      <Text style={styles.sectionHint}>
        {wide
          ? 'The Double take button beside each clip opens it. Pick the shortcut too.'
          : 'The Double take button on each clip opens it. Pick the gesture too.'}
      </Text>
      <View style={[styles.group, tint.group]} role="radiogroup" aria-label="Double take gesture">
        {gestures.map((o, i) => {
          const on = revealGesture === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => appSettings.set('revealGesture', o.id)}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.row,
                i > 0 && styles.rowDivider,
                (pressed || hovered) && styles.rowPressed,
              ]}
              role="radio"
              aria-checked={on}
              accessibilityLabel={`${o.title}. ${o.description}`}
            >
              <View style={[styles.icon, on && tint.iconOn]}>
                <Ionicons name={GESTURE_ICONS[o.id]} size={18} color={on ? c.onAccent : '#fff'} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{o.title}</Text>
                <Text style={styles.rowDesc}>{o.description}</Text>
              </View>
              <View style={[styles.radio, on && tint.radioOn]}>{on && <View style={[styles.radioDot, tint.radioDot]} />}</View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const GESTURE_ICONS: Record<RevealGesture, React.ComponentProps<typeof Ionicons>['name']> = {
  hold: 'finger-print-outline',
  doubleTap: 'hand-left-outline',
  both: 'git-merge-outline',
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  backdropPhone: { justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { overflow: 'hidden' },
  panelPhone: { borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '88%' },
  panelWide: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '86%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    ...(Platform.OS === 'web' ? { boxShadow: '0 24px 64px rgba(0,0,0,0.6)' } : null),
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 10,
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
    marginLeft: 4,
  },
  sectionGap: { marginTop: 22 },
  sectionHint: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4, marginBottom: 10, marginLeft: 4 },
  group: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowDesc: { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 17 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});

const useTint = themed((c) => ({
  panel: { backgroundColor: c.surface },
  group: { backgroundColor: c.surfaceRaised },
  iconOn: { backgroundColor: c.accent },
  radioOn: { borderColor: c.accent },
  radioDot: { backgroundColor: c.accent },
}));
