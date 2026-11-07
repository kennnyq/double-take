import { useEffect, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { loadInitialClips } from '@/data/feed';
import {
  DEFAULT_SETTINGS,
  HOLD_DELAYS,
  changedKeys,
  pipelineChoices,
  type DevSettingKey,
  type DevSettings as Settings,
  type LauncherCorner,
} from './settings';
import {
  DEV_TABS,
  DEV_TOOLS,
  closeDevSettings,
  devSettings,
  openDevSettings,
  selectDevTab,
  useDevPanel,
  useDevSettings,
  type DevTab,
} from './store';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---- what each tab holds ------------------------------------------------------

interface ChoiceItem {
  label: string;
  value: string | number;
  /** A short note under the chips while this item is picked. */
  note?: string;
}
type Row =
  | { kind: 'choice'; key: DevSettingKey; label: string; items: ChoiceItem[] }
  | { kind: 'switch'; key: DevSettingKey; label: string; note?: string }
  | { kind: 'action'; label: string; tone?: 'danger'; run: () => void };
interface Group {
  title: string;
  note?: string;
  rows: Row[];
}

const TAB_META: Record<DevTab, { label: string; icon: IconName }> = {
  interaction: { label: 'Interaction', icon: 'hand-left-outline' },
  model: { label: 'Model', icon: 'hardware-chip-outline' },
  panel: { label: 'Menu', icon: 'options-outline' },
};

/** Settings shown on each tab, so the tab can count and reset its own changes. */
const TAB_KEYS: Record<DevTab, DevSettingKey[]> = {
  interaction: ['revealGesture', 'holdMs', 'gestureHint'],
  model: ['pipeline', 'pipelineBadge'],
  panel: ['launcher'],
};

/** Pipelines the loaded clips have, with how many clips have each. */
function usePipelines(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    loadInitialClips().then((clips) => {
      const c: Record<string, number> = {};
      for (const clip of clips) for (const v of clip.tellsVariants ?? []) c[v.name] = (c[v.name] ?? 0) + 1;
      if (live) setCounts(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return counts;
}

function groupsFor(tab: DevTab, s: Settings, pipelines: Record<string, number>, desktop: boolean): Group[] {
  if (tab === 'interaction') {
    const hold = desktop ? 'Click and hold' : 'Hold';
    const twice = desktop ? 'Double-click' : 'Double tap';
    return [
      {
        title: 'Double take',
        note: 'How you open the tells walkthrough on a clip. The other gesture keeps its usual job.',
        rows: [
          {
            kind: 'choice',
            key: 'revealGesture',
            label: 'Gesture',
            items: [
              {
                label: hold,
                value: 'hold',
                note: `${hold} the video to open it; it stays open until you tap through or close it. ${twice} still likes.`,
              },
              {
                label: twice,
                value: 'doubleTap',
                note: `${twice} the video to open it. Liking moves to the heart button${desktop ? '' : '; hold still plays at 2x'}.`,
              },
            ],
          },
          {
            kind: 'choice',
            key: 'holdMs',
            label: 'Hold length',
            items: HOLD_DELAYS.map((ms) => ({ label: `${ms} ms`, value: ms })),
          },
          { kind: 'switch', key: 'gestureHint', label: 'Hint on clips', note: 'A small label naming the gesture on clips that have tells.' },
        ],
      },
    ];
  }
  if (tab === 'model') {
    const names = pipelineChoices(Object.keys(pipelines), s.pipeline);
    const withTells = pipelines.main ?? 0;
    return [
      {
        title: 'Tells pipeline',
        note: 'One model for every clip. Clips that have no tells from it show main’s.',
        rows: [
          {
            kind: 'choice',
            key: 'pipeline',
            label: 'Model',
            items: names.map((n) => ({
              label: n,
              value: n,
              note:
                n === 'main'
                  ? `The published tells${withTells ? `, on ${withTells} clips` : ''}.`
                  : `On ${pipelines[n] ?? 0} of ${withTells} clips with tells.`,
            })),
          },
          { kind: 'switch', key: 'pipelineBadge', label: 'Badge on clips', note: 'Shows the model and its tell count; tap it to come back here.' },
        ],
      },
    ];
  }
  return [
    {
      title: 'Launcher',
      rows: [
        {
          kind: 'choice',
          key: 'launcher',
          label: 'Position',
          items: [
            { label: 'Auto', value: 'auto', note: desktop ? 'Top right of the window.' : 'Top right, under the top bar.' },
            { label: 'Top right', value: 'topRight' },
            { label: 'Top left', value: 'topLeft' },
            { label: 'Bottom right', value: 'bottomRight' },
            { label: 'Bottom left', value: 'bottomLeft' },
          ],
        },
      ],
    },
    {
      title: 'Saved settings',
      note: Platform.OS === 'web' ? 'Kept in this browser. Any web build opened with ?dev shows this menu.' : 'Kept on this device.',
      rows: [{ kind: 'action', label: 'Reset all dev settings', tone: 'danger', run: () => devSettings.reset() }],
    },
  ];
}

// ---- launcher and panel ---------------------------------------------------------

/**
 * The dev settings: a small floating launcher and a tabbed panel of settings
 * to try things out (the double take's gesture, the tells model, …). Every
 * change applies at once and is saved on the device. Shown in dev builds and
 * on web with `?dev`.
 */
export function DevSettings({ desktop }: { desktop: boolean }) {
  if (!DEV_TOOLS) return null;
  return <DevSettingsInner desktop={desktop} />;
}

function DevSettingsInner({ desktop }: { desktop: boolean }) {
  const s = useDevSettings();
  const { open, tab } = useDevPanel();
  const insets = useSafeAreaInsets();
  const changed = changedKeys(s).length;

  // Escape closes the panel on web.
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDevSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const corner = resolveCorner(s.launcher);
  const top = corner.startsWith('top');
  const left = corner.endsWith('Left');
  // Clear of the phone's top bar and tells chips, and of its tab bar.
  const vy = desktop ? 20 : top ? insets.top + 96 : insets.bottom + 64;
  const launcherPos = { [top ? 'top' : 'bottom']: vy, [left ? 'left' : 'right']: desktop ? 20 : 12 };

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      {open && (
        <>
          <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={closeDevSettings} accessibilityLabel="Close dev settings" />
          <Panel
            tab={tab}
            settings={s}
            desktop={desktop}
            style={
              desktop
                ? [styles.panelDesktop, { [top ? 'top' : 'bottom']: vy + 52, [left ? 'left' : 'right']: 20 }]
                : [styles.panelPhone, { bottom: insets.bottom + 8 }]
            }
          />
        </>
      )}
      <Pressable
        onPress={() => (open ? closeDevSettings() : openDevSettings())}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.launcher,
          launcherPos,
          open && styles.launcherOpen,
          (pressed || hovered) && styles.launcherHover,
        ]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close dev settings' : 'Dev settings'}
      >
        <Ionicons name={open ? 'close' : 'construct-outline'} size={18} color={open ? '#111' : '#fff'} />
        {!open && changed > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{changed}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function resolveCorner(c: LauncherCorner): Exclude<LauncherCorner, 'auto'> {
  // Top right on both: desktop's bottom right holds the landing's design trial bar.
  return c === 'auto' ? 'topRight' : c;
}

function Panel({ tab, settings: s, desktop, style }: { tab: DevTab; settings: Settings; desktop: boolean; style: object }) {
  const pipelines = usePipelines();
  const { height } = useWindowDimensions();
  const groups = useMemo(() => groupsFor(tab, s, pipelines, desktop), [tab, s, pipelines, desktop]);
  const tabChanged = TAB_KEYS[tab].filter((k) => s[k] !== DEFAULT_SETTINGS[k]);

  return (
    <View style={[styles.panel, style, { maxHeight: Math.min(560, height * (desktop ? 0.7 : 0.72)) }]} accessibilityViewIsModal>
      <View style={styles.head}>
        <Ionicons name="construct" size={16} color={ACCENT} />
        <Text style={styles.headTitle}>Dev settings</Text>
        <View style={{ flex: 1 }} />
        {tabChanged.length > 0 && (
          <Pressable
            onPress={() => devSettings.reset(tabChanged)}
            style={({ pressed }) => [styles.headBtn, pressed && styles.dim]}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${TAB_META[tab].label}`}
          >
            <Ionicons name="refresh" size={14} color="#ddd" />
            <Text style={styles.headBtnText}>Reset tab</Text>
          </Pressable>
        )}
        <Pressable onPress={closeDevSettings} hitSlop={8} style={({ pressed }) => [styles.close, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={18} color="#ddd" />
        </Pressable>
      </View>

      <TabBar tab={tab} settings={s} />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {g.note ? <Text style={styles.groupNote}>{g.note}</Text> : null}
            <View style={styles.rows}>
              {g.rows.map((r) => (
                <RowView key={r.label} row={r} settings={s} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Equal-width tabs with a highlight that slides to the picked one, and a count of changes on each. */
function TabBar({ tab, settings: s }: { tab: DevTab; settings: Settings }) {
  const [w, setW] = useState(0);
  const index = DEV_TABS.indexOf(tab);
  const [x] = useState(() => new Animated.Value(index));
  useEffect(() => {
    Animated.spring(x, { toValue: index, useNativeDriver: Platform.OS !== 'web', speed: 24, bounciness: 4 }).start();
  }, [index, x]);
  const tabW = (w - 8) / DEV_TABS.length; // inside the bar's 4px padding

  return (
    <View style={styles.tabs} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {w > 0 && (
        <Animated.View
          style={[styles.tabIndicator, { width: tabW - 8, transform: [{ translateX: Animated.multiply(x, tabW) }] }]}
          pointerEvents="none"
        />
      )}
      {DEV_TABS.map((t) => {
        const on = t === tab;
        const n = TAB_KEYS[t].filter((k) => s[k] !== DEFAULT_SETTINGS[k]).length;
        return (
          <Pressable
            key={t}
            onPress={() => selectDevTab(t)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n ? `${TAB_META[t].label}, ${n} changed` : TAB_META[t].label}
          >
            <View>
              <Ionicons name={TAB_META[t].icon} size={18} color={on ? '#111' : '#bbb'} />
              {n > 0 && <View style={styles.tabDot} />}
            </View>
            <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{TAB_META[t].label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const SWITCH_ITEMS: ChoiceItem[] = [
  { label: 'On', value: 1 },
  { label: 'Off', value: 0 },
];

function RowView({ row, settings: s }: { row: Row; settings: Settings }) {
  if (row.kind === 'action') {
    return (
      <Pressable
        onPress={row.run}
        style={({ pressed }) => [styles.action, row.tone === 'danger' && styles.actionDanger, pressed && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={[styles.actionText, row.tone === 'danger' && styles.actionTextDanger]}>{row.label}</Text>
      </Pressable>
    );
  }
  const value = s[row.key];
  const changed = value !== DEFAULT_SETTINGS[row.key];
  const isSwitch = row.kind === 'switch';
  const items = isSwitch ? SWITCH_ITEMS : row.items;
  const selected = isSwitch ? (value ? 1 : 0) : value;
  const def = isSwitch ? (DEFAULT_SETTINGS[row.key] ? 1 : 0) : DEFAULT_SETTINGS[row.key];
  const note = isSwitch ? row.note : row.items.find((i) => i.value === selected)?.note;

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        {changed && <View style={styles.changed} accessibilityLabel="Changed from its default" />}
        <Text style={styles.rowLabel}>{row.label}</Text>
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={row.label}>
        {items.map((it) => {
          const on = it.value === selected;
          return (
            <Pressable
              key={String(it.value)}
              onPress={() => devSettings.set({ [row.key]: isSwitch ? it.value === 1 : it.value })}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && styles.dim]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{it.label}</Text>
              {it.value === def && <View style={[styles.defaultDot, on && styles.defaultDotOn]} />}
            </Pressable>
          );
        })}
      </View>
      {note ? <Text style={styles.rowNote}>{note}</Text> : null}
    </View>
  );
}

const ACCENT = '#FFD60A';

const styles = StyleSheet.create({
  // Above the app's sheets, and on web above the landing's design trial bar (z-index 1000).
  layer: { zIndex: 1001 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  launcher: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,22,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderStyle: 'dashed',
  },
  launcherOpen: { backgroundColor: ACCENT, borderColor: ACCENT, borderStyle: 'solid' },
  launcherHover: { transform: [{ scale: 1.06 }] },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#111', fontSize: 10, fontWeight: '800' },

  panel: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(22,22,24,0.97)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  panelDesktop: { width: 380 },
  panelPhone: { left: 8, right: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headBtnText: { color: '#ddd', fontSize: 12, fontWeight: '600' },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  dim: { opacity: 0.6 },

  tabs: { flexDirection: 'row', padding: 4, marginHorizontal: 10, marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  tabIndicator: { position: 'absolute', left: 8, top: 4, bottom: 4, borderRadius: 11, backgroundColor: ACCENT },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 7 },
  tabDot: { position: 'absolute', top: -2, right: -5, width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff6b3d' },
  tabLabel: { color: '#bbb', fontSize: 11, fontWeight: '600' },
  tabLabelOn: { color: '#111' },

  body: { flexGrow: 0 },
  bodyContent: { padding: 14, gap: 18 },
  group: { gap: 6 },
  groupTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  groupNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },
  rows: { gap: 14, marginTop: 4 },
  row: { gap: 7 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changed: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff6b3d' },
  rowLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rowNote: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: '#eee', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#111' },
  /** Marks the default choice. */
  defaultDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  defaultDotOn: { backgroundColor: 'rgba(0,0,0,0.45)' },
  action: {
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  actionDanger: { backgroundColor: 'rgba(255,69,58,0.14)' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionTextDanger: { color: '#ff6961' },
});
