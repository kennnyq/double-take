import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { containOverscroll, ownWheelProps } from '@/ui/ownWheel';
import { useDevTabs } from './api';
import { BuiltInSources } from './builtins';
import { DEV_EASE_MS, useDevChrome } from './chrome';
import { Arrow, NATIVE, RowView, useEased } from './controls';
import { findRow, resetRows, rowKey, searchTabs, stepValue, type ResolvedSection, type ResolvedTab } from './registry';
import type { LauncherCorner } from './settings';
import { DEV_TOOLS, closeDevSettings, openDevSettings, pinDevRow, selectDevTab, toggleDevSettings, useDevPanel, useDevSettings, usePinnedRow } from './store';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The dev settings: one launcher button and a tabbed panel to try things out
 * (the hold length, the tells model, the palette, test accounts, UI flows…).
 * Every change applies at once and is kept on the device. A setting pinned to
 * the launcher steps ‹ › from there, as the landing's design bar does.
 * Dev builds only. What the tabs hold comes from the registry (`registry.ts`).
 */
export function DevSettings({ desktop, onShowLanding }: { desktop: boolean; onShowLanding?: () => void }) {
  if (!DEV_TOOLS) return null;
  return (
    <>
      <BuiltInSources desktop={desktop} onShowLanding={onShowLanding} />
      <DevSettingsHost desktop={desktop} />
    </>
  );
}

function DevSettingsHost({ desktop }: { desktop: boolean }) {
  const s = useDevSettings();
  const tabs = useDevTabs();
  const { open, tab } = useDevPanel();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const changed = tabs.reduce((n, t) => n + t.changed, 0);

  // Mounted while open or easing shut; the move turns round if toggled midway.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const [progress] = useState(() => new Animated.Value(open ? 1 : 0));
  useEffect(() => {
    const a = Animated.timing(progress, { toValue: open ? 1 : 0, duration: DEV_EASE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => a.stop();
  }, [open, progress]);

  // Web: Esc closes; ⌘. or Ctrl+. opens and closes.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        toggleDevSettings();
      } else if (e.key === 'Escape') closeDevSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const corner = resolveCorner(s.launcher);
  const top = corner.startsWith('top');
  const left = corner.endsWith('Left');
  // Clear of the phone's top bar and tells chips, and of its tab bar.
  const vy = desktop ? 20 : top ? insets.top + 96 : insets.bottom + 64;
  const side = desktop ? 20 : 12;
  const launcherPos = { [top ? 'top' : 'bottom']: vy, [left ? 'left' : 'right']: side };

  const panelH = desktop ? Math.min(560, height - vy - 52 - 20) : Math.min(560, Math.round(height * 0.66));
  const panelPlace = desktop
    ? { width: 400, maxHeight: panelH, [top ? 'top' : 'bottom']: vy + 52, [left ? 'left' : 'right']: side }
    : { left: 8, right: 8, maxHeight: panelH, bottom: insets.bottom + 8 };
  // It grows out of the launcher on desktop and rises from the bottom on phones.
  const fromY = desktop ? (top ? -10 : 10) : 28;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      {mounted && !desktop && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]} pointerEvents={open ? 'auto' : 'none'}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDevSettings} accessibilityLabel="Close dev settings" />
        </Animated.View>
      )}
      {mounted && (
        <Animated.View
          {...ownWheelProps}
          pointerEvents={open ? 'auto' : 'none'}
          style={[
            styles.panelHost,
            panelPlace,
            {
              opacity: progress,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
              ],
            },
          ]}
        >
          <Panel tabs={tabs} tab={tab} desktop={desktop} maxBody={panelH - PANEL_CHROME} />
        </Animated.View>
      )}
      <Launcher tabs={tabs} open={open} changed={changed} left={left} style={launcherPos} />
    </View>
  );
}

function resolveCorner(c: LauncherCorner): Exclude<LauncherCorner, 'auto'> {
  // Top right on both: desktop's bottom right holds the landing's design bar.
  return c === 'auto' ? 'topRight' : c;
}

// ---- launcher: the button, and a pinned setting's ‹ value › pill beside it ------------------

function Launcher({ tabs, open, changed, left, style }: { tabs: ResolvedTab[]; open: boolean; changed: number; left: boolean; style: object }) {
  const c = useDevChrome();
  const pinned = usePinnedRow();
  const hit = pinned ? findRow(tabs, pinned) : null;
  const row = hit?.row.kind === 'choice' ? hit.row : null;
  const item = row?.items.find((i) => i.value === row.value);

  return (
    <View style={[styles.launcherRow, { flexDirection: left ? 'row' : 'row-reverse' }, style]} pointerEvents="box-none">
      <Pressable
        onPress={toggleDevSettings}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.launcher,
          open ? c.on : c.panel,
          (pressed || hovered) && styles.launcherHover,
        ]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close dev settings' : changed ? `Dev settings, ${changed} changed` : 'Dev settings'}
      >
        <Ionicons name={open ? 'close' : 'construct-outline'} size={18} color={open ? c.onText.color : c.text.color} />
        {!open && changed > 0 && (
          <View style={[styles.badge, c.on]}>
            <Text style={[styles.badgeText, c.onText]}>{changed}</Text>
          </View>
        )}
      </Pressable>
      {row && hit && (
        <View style={[styles.pill, c.panel]}>
          <Arrow dir={-1} label={`Previous ${row.label}`} onPress={() => row.onSelect(stepValue(row.items, row.value, -1))} />
          <Pressable
            onPress={() => openDevSettings(hit.tab.id)}
            style={styles.pillName}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}: ${item?.label ?? row.value}. Open its tab`}
          >
            <Text style={[styles.pillLabel, c.dim]} numberOfLines={1}>
              {row.label}
            </Text>
            <Text style={[styles.pillValue, c.text]} numberOfLines={1}>
              {item?.label ?? String(row.value)}
            </Text>
          </Pressable>
          <Arrow dir={1} label={`Next ${row.label}`} onPress={() => row.onSelect(stepValue(row.items, row.value, 1))} />
        </View>
      )}
    </View>
  );
}

// ---- panel ---------------------------------------------------------------------------------

/** Roughly the panel's height outside its body: the search, the tabs and the footer. */
const PANEL_CHROME = 160;
/** The search results' key among the measured heights. */
const SEARCH = ' search';

function Panel({ tabs, tab, desktop, maxBody }: { tabs: ResolvedTab[]; tab: string; desktop: boolean; maxBody: number }) {
  const c = useDevChrome();
  const [query, setQuery] = useState('');
  const [pageW, setPageW] = useState(0);
  const index = Math.max(0, tabs.findIndex((t) => t.id === tab));
  const current = tabs[index];
  // Navigation cuts: another tab (or the search) shows at once, highlight and all.
  const tabPos = useEased(index, { jump: true });
  const searching = query.trim().length > 0;
  // The body fits the view's content, up to the room there is; then it scrolls. It
  // snaps to a new view's height, and eases as a view's own content changes.
  const [contentH, setContentH] = useState<Record<string, number>>({});
  const fit = searching ? contentH[SEARCH] : current && contentH[current.id];
  const bodyH = useEased(fit ? Math.min(maxBody, fit) : maxBody, { native: false, cutOn: searching ? SEARCH : current?.id });
  const measure = (id: string) => (_w: number, h: number) =>
    setContentH((m) => (m[id] === h ? m : { ...m, [id]: h }));

  return (
    <View style={[styles.panel, c.panel]} accessibilityViewIsModal={!desktop} accessibilityLabel="Dev settings">
      <View style={styles.head}>
        <View style={[styles.search, c.raised]}>
          <Ionicons name="search" size={15} color={c.dim.color} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a setting"
            placeholderTextColor={c.dim.color}
            style={[styles.searchInput, c.text, WEB_NO_OUTLINE]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Find a setting"
          />
          {searching && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear the search">
              <Ionicons name="close-circle" size={16} color={c.dim.color} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={closeDevSettings}
          hitSlop={6}
          style={({ hovered }: { hovered?: boolean }) => [styles.close, hovered && c.raised]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={18} color={c.text.color} />
        </Pressable>
      </View>

      {!searching && <TabStrip tabs={tabs} index={index} tabPos={tabPos} />}

      <Animated.View style={[styles.view, { height: bodyH }]} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
        {searching ? (
          <SearchResults
            tabs={tabs}
            query={query}
            onContentSizeChange={measure(SEARCH)}
            onGo={(id) => {
              setQuery('');
              selectDevTab(id);
            }}
          />
        ) : (
          pageW > 0 && (
            <Animated.View
              style={[styles.pager, { width: pageW * tabs.length, transform: [{ translateX: Animated.multiply(tabPos, -pageW) }] }]}
            >
              {tabs.map((t) => (
                <ScrollView
                  key={t.id}
                  style={[{ width: pageW }, containOverscroll]}
                  contentContainerStyle={styles.page}
                  onContentSizeChange={measure(t.id)}
                  keyboardShouldPersistTaps="handled"
                >
                  {t.sections.map((sec) => (
                    <SectionView key={sec.id} section={sec} />
                  ))}
                </ScrollView>
              ))}
            </Animated.View>
          )
        )}
      </Animated.View>

      {!searching && current && <Footer tab={current} />}
    </View>
  );
}

const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

/** Equal tabs, icons over labels, with a highlight that slides to the picked one. */
function TabStrip({ tabs, index, tabPos }: { tabs: ResolvedTab[]; index: number; tabPos: Animated.Value }) {
  const c = useDevChrome();
  const [w, setW] = useState(0);
  const tabW = tabs.length ? (w - 8) / tabs.length : 0; // inside the strip's 4px padding
  return (
    <View style={styles.tabs} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {w > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.tabIndicator, c.raised, { width: tabW, transform: [{ translateX: Animated.multiply(tabPos, tabW) }] }]}
        />
      )}
      {tabs.map((t, i) => {
        const on = i === index;
        return (
          <Pressable
            key={t.id}
            onPress={() => selectDevTab(t.id)}
            style={({ hovered }: { hovered?: boolean }) => [styles.tab, hovered && !on && styles.tabHover]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.changed ? `${t.label}, ${t.changed} changed` : t.label}
          >
            <View>
              <Ionicons name={t.icon as IconName} size={18} color={on ? c.text.color : c.dim.color} />
              {t.changed > 0 && (
                <View style={[styles.tabBadge, c.on]}>
                  <Text style={[styles.tabBadgeText, c.onText]}>{t.changed}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.tabLabel, on ? c.text : c.dim]} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionView({ section, rows = section.rows, context }: { section: ResolvedSection; rows?: ResolvedSection['rows']; context?: string }) {
  const c = useDevChrome();
  const pinned = usePinnedRow();
  const { Component } = section;
  return (
    <View style={styles.section}>
      {(section.title || context) && (
        <Text style={[styles.sectionTitle, c.dim]}>{context ? `${context} · ${section.title ?? ''}` : section.title}</Text>
      )}
      {section.note && !context ? <Text style={[styles.sectionNote, c.dim]}>{section.note}</Text> : null}
      {rows.length > 0 && (
        <View style={styles.rows}>
          {rows.map((r) => {
            const key = rowKey(section.id, r);
            return (
              <RowView
                key={key}
                row={r}
                pinned={pinned === key}
                onPin={r.kind === 'choice' && r.items.length > 1 ? () => pinDevRow(pinned === key ? null : key) : undefined}
              />
            );
          })}
        </View>
      )}
      {Component && !context ? <Component /> : null}
    </View>
  );
}

function SearchResults({
  tabs,
  query,
  onGo,
  onContentSizeChange,
}: {
  tabs: ResolvedTab[];
  query: string;
  onGo(tab: string): void;
  onContentSizeChange(w: number, h: number): void;
}) {
  const c = useDevChrome();
  const hits = searchTabs(tabs, query);
  return (
    <ScrollView style={containOverscroll} contentContainerStyle={styles.page} onContentSizeChange={onContentSizeChange} keyboardShouldPersistTaps="handled">
      {hits.length === 0 && <Text style={[styles.sectionNote, c.dim]}>Nothing matches “{query.trim()}”.</Text>}
      {hits.map((h) => (
        <View key={h.section.id} style={styles.hit}>
          <SectionView section={h.section} rows={h.rows} context={h.tab.label} />
          {h.section.Component && (
            <Pressable onPress={() => onGo(h.tab.id)} style={({ hovered }: { hovered?: boolean }) => [styles.goTab, c.raised, hovered && styles.tabHover]} accessibilityRole="button">
              <Text style={[styles.goTabText, c.text]}>Open {h.tab.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={c.dim.color} />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/** Under the tab: how many of its settings are changed, and a reset. */
function Footer({ tab }: { tab: ResolvedTab }) {
  const c = useDevChrome();
  const rows = tab.sections.flatMap((s) => s.rows);
  const resettable = rows.some((r) => r.kind !== 'action' && r.defaultValue !== undefined);
  return (
    <View style={styles.footer}>
      <Text style={[styles.footerText, c.dim]}>
        {!resettable ? 'Nothing to reset here' : tab.changed === 0 ? 'All defaults' : `${tab.changed} changed`}
      </Text>
      <Pressable
        onPress={() => resetRows(rows)}
        disabled={tab.changed === 0}
        style={({ hovered }: { hovered?: boolean }) => [styles.reset, c.raised, tab.changed === 0 && styles.disabled, hovered && styles.tabHover]}
        accessibilityRole="button"
        accessibilityLabel={`Reset ${tab.label} to defaults`}
      >
        <Ionicons name="refresh" size={13} color={c.text.color} />
        <Text style={[styles.resetText, c.text]}>Reset tab</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the app's sheets, and on web above the landing's design bar (z-index 1000).
  layer: { zIndex: 1001 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.3)' },

  launcherRow: { position: 'absolute', alignItems: 'center', gap: 8 },
  launcher: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  launcherHover: { transform: [{ scale: 1.05 }] },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 4,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 260,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pillName: { flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 4 },
  pillLabel: { fontSize: 12, fontWeight: '600' },
  pillValue: { fontSize: 13, fontWeight: '700', flexShrink: 1 },

  panelHost: { position: 'absolute' },
  panel: {
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 6, paddingTop: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 10, borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0, minWidth: 0 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  tabs: { flexDirection: 'row', padding: 4, marginHorizontal: 6, marginTop: 6 },
  tabIndicator: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 12 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 7, borderRadius: 12 },
  tabHover: { opacity: 0.85 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
  tabBadge: { position: 'absolute', top: -5, right: -10, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 9, fontWeight: '800' },

  view: { overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', marginTop: 4 },
  pager: { flex: 1, flexDirection: 'row' },
  page: { padding: 14, gap: 20 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionNote: { fontSize: 12, lineHeight: 16 },
  rows: { gap: 14, marginTop: 6 },
  hit: { gap: 8 },
  goTab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 36, paddingHorizontal: 12, borderRadius: 10 },
  goTabText: { fontSize: 13, fontWeight: '600' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  footerText: { fontSize: 12, fontWeight: '600' },
  reset: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14 },
  resetText: { fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
