import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEV_EASE_MS, useDevChrome } from './chrome';
import { choiceDisplay, rowChanged, stepValue, type DevChoiceItem, type DevChoiceRow, type DevRow, type DevValue } from './registry';

/** The native driver where it can run (not web), for transforms and opacity. */
export const NATIVE = Platform.OS !== 'web';

/** How long after a cut (`cutOn` changing) the value keeps snapping, while the new view lays out. */
const CUT_SETTLE_MS = 300;

/**
 * A value that eases to `target` whenever it changes, from wherever it is, so
 * a new target mid-move turns it around smoothly. `jump` sets it at once
 * (e.g. while hidden); so does the first target. When `cutOn` changes (a
 * navigation, such as another tab) it snaps instead, as do the changes that
 * follow right after while the new view measures itself.
 */
export function useEased(
  target: number | null,
  { native = NATIVE, jump = false, ms = DEV_EASE_MS, cutOn }: { native?: boolean; jump?: boolean; ms?: number; cutOn?: string | number } = {},
) {
  const [v] = useState(() => new Animated.Value(target ?? 0));
  const placed = useRef(target !== null);
  const cut = useRef({ key: cutOn, at: -Infinity });
  useEffect(() => {
    if (target === null) return;
    const now = Date.now();
    if (cut.current.key !== cutOn) cut.current = { key: cutOn, at: now };
    if (!placed.current || jump || now - cut.current.at < CUT_SETTLE_MS) {
      placed.current = true;
      v.stopAnimation();
      v.setValue(target);
      return;
    }
    const a = Animated.timing(v, { toValue: target, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    a.start();
    return () => a.stop();
  }, [target, jump, ms, native, v, cutOn]);
  return v;
}

// ---- rows ---------------------------------------------------------------------------

export function RowView({ row, pinned, onPin }: { row: DevRow; pinned?: boolean; onPin?: () => void }) {
  const c = useDevChrome();
  if (row.kind === 'action') {
    const danger = row.tone === 'danger';
    return (
      <Pressable
        onPress={row.run}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.action,
          danger ? [styles.actionOutline, c.border] : c.raised,
          (pressed || hovered) && styles.hover,
        ]}
        accessibilityRole="button"
        accessibilityHint={row.note}
      >
        <View style={styles.actionText}>
          <Text style={[styles.label, c.text]}>{row.label}</Text>
          {row.note ? <Text style={[styles.note, c.dim]}>{row.note}</Text> : null}
        </View>
        <Ionicons name={danger ? 'trash-outline' : 'chevron-forward'} size={16} color={c.dim.color} />
      </Pressable>
    );
  }

  const changed = rowChanged(row);
  const head = (
    <View style={styles.labelWrap}>
      <Text style={[styles.label, c.text]} numberOfLines={1}>
        {row.label}
      </Text>
      {changed && <View style={[styles.changed, c.on]} accessibilityLabel="Changed from its default" />}
    </View>
  );

  if (row.kind === 'switch') {
    return (
      <View style={styles.row}>
        <View style={styles.line}>
          {head}
          <Toggle value={row.value} onChange={row.onChange} label={row.label} />
        </View>
        {row.note ? <Text style={[styles.note, c.dim]}>{row.note}</Text> : null}
      </View>
    );
  }

  const note = row.items.find((i) => i.value === row.value)?.note;
  const pin = onPin ? (
    <Pressable
      onPress={onPin}
      hitSlop={8}
      style={({ hovered }: { hovered?: boolean }) => [styles.pin, (pinned || hovered) && styles.pinOn]}
      accessibilityRole="button"
      accessibilityLabel={pinned ? `Unpin ${row.label} from the launcher` : `Pin ${row.label} to the launcher`}
      accessibilityState={{ selected: !!pinned }}
    >
      <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={16} color={pinned ? c.text.color : c.dim.color} />
    </Pressable>
  ) : null;

  if (choiceDisplay(row) === 'stepper') {
    return (
      <View style={styles.row}>
        <View style={styles.line}>
          {head}
          <Stepper row={row} />
          {pin}
        </View>
        {note ? <Text style={[styles.note, c.dim]}>{note}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        {head}
        {pin}
      </View>
      <Chips items={row.items} value={row.value} defaultValue={row.defaultValue} onSelect={row.onSelect} label={row.label} />
      {note ? <Text style={[styles.note, c.dim]}>{note}</Text> : null}
    </View>
  );
}

// ---- chips: a segmented control whose highlight slides to the pick ---------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Chips({
  items,
  value,
  defaultValue,
  onSelect,
  label,
}: {
  items: readonly DevChoiceItem[];
  value: DevValue;
  defaultValue?: DevValue;
  onSelect(v: DevValue): void;
  label: string;
}) {
  const c = useDevChrome();
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const box = boxes[String(value)] ?? null;
  // Width and height can't use the native driver, so the whole thumb runs on JS.
  const x = useEased(box?.x ?? null, { native: false });
  const y = useEased(box?.y ?? null, { native: false });
  const w = useEased(box?.w ?? null, { native: false });
  const h = useEased(box?.h ?? null, { native: false });

  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const { x: bx, y: by, width, height } = e.nativeEvent.layout;
    setBoxes((b) => {
      const o = b[key];
      return o && o.x === bx && o.y === by && o.w === width && o.h === height ? b : { ...b, [key]: { x: bx, y: by, w: width, h: height } };
    });
  };

  return (
    <View style={[styles.chips, c.raised]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {box && <Animated.View pointerEvents="none" style={[styles.thumb, c.on, { width: w, height: h, transform: [{ translateX: x }, { translateY: y }] }]} />}
      {items.map((it) => {
        const on = it.value === value;
        return (
          <Pressable
            key={String(it.value)}
            onLayout={measure(String(it.value))}
            onPress={() => onSelect(it.value)}
            style={({ hovered }: { hovered?: boolean }) => [styles.chip, hovered && !on && styles.chipHover]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={it.value === defaultValue ? `${it.label}, default` : it.label}
          >
            <Text style={[styles.chipText, on ? c.onText : c.text]} numberOfLines={1}>
              {it.label}
            </Text>
            {it.value === defaultValue && <View style={[styles.defaultDot, { backgroundColor: on ? c.onText.color : c.dim.color }]} />}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- stepper: ‹ value › as the landing's trial bar ---------------------------------------

export function Stepper({ row, compact }: { row: DevChoiceRow; compact?: boolean }) {
  const c = useDevChrome();
  const i = row.items.findIndex((it) => it.value === row.value);
  const item = row.items[i];
  const step = (dir: 1 | -1) => row.onSelect(stepValue(row.items, row.value, dir));
  return (
    <View style={[styles.stepper, c.raised, compact && styles.stepperCompact]}>
      <Arrow dir={-1} label={`Previous ${row.label}`} onPress={() => step(-1)} />
      <Pressable onPress={() => step(1)} style={styles.stepValue} accessibilityRole="adjustable" accessibilityLabel={row.label} accessibilityValue={{ text: item?.label ?? String(row.value) }}>
        <Text style={[styles.stepText, c.text]} numberOfLines={1}>
          {item?.label ?? String(row.value)}
        </Text>
        {!compact && (
          <Text style={[styles.stepCount, c.dim]}>
            {i + 1}/{row.items.length}
          </Text>
        )}
      </Pressable>
      <Arrow dir={1} label={`Next ${row.label}`} onPress={() => step(1)} />
    </View>
  );
}

export function Arrow({ dir, label, onPress }: { dir: 1 | -1; label: string; onPress(): void }) {
  const c = useDevChrome();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.arrow, (pressed || hovered) && styles.arrowHover]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={16} color={c.text.color} />
    </Pressable>
  );
}

// ---- toggle ------------------------------------------------------------------------------

export function Toggle({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  const c = useDevChrome();
  const p = useEased(value ? 1 : 0, { native: false });
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} hitSlop={6}>
      <Animated.View style={[styles.track, c.raised]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.trackOn, c.on, { opacity: p }]} />
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: value ? c.onText.color : c.text.color,
              transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  labelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  changed: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  note: { fontSize: 12, lineHeight: 16 },
  hover: { opacity: 0.85 },

  pin: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  pinOn: { opacity: 1 },

  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  actionText: { flex: 1, gap: 2 },
  actionOutline: { borderWidth: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', padding: 3, borderRadius: 12, alignSelf: 'stretch' },
  thumb: { position: 'absolute', left: 0, top: 0, borderRadius: 9 },
  chip: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 30, paddingHorizontal: 12, borderRadius: 9 },
  chipHover: { backgroundColor: 'rgba(255,255,255,0.06)' },
  chipText: { fontSize: 13, fontWeight: '700' },
  defaultDot: { width: 4, height: 4, borderRadius: 2, opacity: 0.6 },

  stepper: { flexDirection: 'row', alignItems: 'center', height: 32, borderRadius: 16, paddingHorizontal: 2, maxWidth: 220 },
  stepperCompact: { maxWidth: 200 },
  stepValue: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  stepText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  stepCount: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  arrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  arrowHover: { backgroundColor: 'rgba(255,255,255,0.1)' },

  track: { width: 44, height: 26, borderRadius: 13, padding: 3, overflow: 'hidden' },
  trackOn: { borderRadius: 13 },
  knob: { width: 20, height: 20, borderRadius: 10 },
});
