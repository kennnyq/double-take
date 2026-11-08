import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { openSignIn } from '@/auth/gate';
import { loadInitialClips } from '@/data/feed';
import { openSettings } from '@/settings/store';
import { DEFAULT_PALETTE, LEGACY_PALETTES, PALETTES, PALETTE_IDS, setPalette, usePalette, type PaletteId } from '@/ui/theme';
import { AccountsTab } from './AccountsTab';
import { registerDevSection, registerDevTab, settingChoice, useDevSection } from './api';
import { PaletteSwatches } from './PaletteSwatches';
import { HOLD_DELAYS, pipelineChoices } from './settings';
import { closeDevSettings, devSettings, pinDevRow } from './store';

/*
 * The built-in tabs and their sections. Each is registered the way any other
 * feature can (see the top of `registry.ts`).
 */

registerDevTab({ id: 'interaction', label: 'Interaction', icon: 'hand-left-outline', order: 10 });
registerDevTab({ id: 'model', label: 'Model', icon: 'hardware-chip-outline', order: 20 });
registerDevTab({ id: 'colors', label: 'Colors', icon: 'color-palette-outline', order: 30 });
registerDevTab({ id: 'flows', label: 'Flows', icon: 'git-branch-outline', order: 40 });
registerDevTab({ id: 'accounts', label: 'Accounts', icon: 'people-outline', order: 50 });
registerDevTab({ id: 'panel', label: 'Menu', icon: 'options-outline', order: 90 });

registerDevSection({
  id: 'colors/swatches',
  tab: 'colors',
  title: 'This palette',
  order: 10,
  Component: PaletteSwatches,
});

// Test sign-ins through the Worker's dev routes.
registerDevSection({ id: 'accounts', tab: 'accounts', Component: AccountsTab, keywords: 'sign in test account guest token' });

registerDevSection({
  id: 'panel/launcher',
  tab: 'panel',
  title: 'Launcher',
  note: 'Pin a setting (the pin by its name) to step through it from the launcher without opening this.',
  rows: (s) => [
    settingChoice(s, 'launcher', 'Position', [
      { label: 'Auto', value: 'auto', note: 'Top right.' },
      { label: 'Top right', value: 'topRight' },
      { label: 'Top left', value: 'topLeft' },
      { label: 'Bottom right', value: 'bottomRight' },
      { label: 'Bottom left', value: 'bottomLeft' },
    ]),
  ],
});

registerDevSection({
  id: 'panel/saved',
  tab: 'panel',
  title: 'Saved settings',
  note: Platform.OS === 'web' ? 'Kept in this browser. ⌘. or Ctrl+. opens and closes this menu; Esc closes it.' : 'Kept on this device.',
  order: 10,
  rows: [
    {
      kind: 'action',
      label: 'Reset every dev setting',
      tone: 'danger',
      run: () => {
        devSettings.reset();
        setPalette(DEFAULT_PALETTE);
        pinDevRow(null);
      },
    },
  ],
});

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

/**
 * The sections that depend on live state (the layout, the loaded clips, the
 * palette). Rendered by the panel's host; reads no registry itself.
 */
export function BuiltInSources({ desktop, onShowLanding }: { desktop: boolean; onShowLanding?: () => void }) {
  const pipelines = usePipelines();
  const palette = usePalette();

  useDevSection(() => {
    const hold = desktop ? 'Holding Space (or the mouse button)' : 'A press';
    return {
      id: 'interaction/hold',
      tab: 'interaction',
      title: 'Hold',
      note: 'Which gesture opens the double take is a user setting (Settings → Double take).',
      rows: (s) => [
        settingChoice(
          s,
          'holdMs',
          'Hold length',
          HOLD_DELAYS.map((ms) => ({ label: `${ms} ms`, value: ms, note: `${hold} this long counts as a hold.` })),
        ),
      ],
    };
  }, [desktop]);

  useDevSection(() => {
    const withTells = pipelines.main ?? 0;
    return {
      id: 'model/pipeline',
      tab: 'model',
      title: 'Tells pipeline',
      note: 'One model for every clip. Clips with no tells from it show main’s.',
      rows: (s) =>
        [
          settingChoice(
            s,
            'pipeline',
            'Model',
            pipelineChoices(Object.keys(pipelines), s.pipeline).map((n) => ({
              label: n,
              value: n,
              note: n === 'main' ? `The published tells${withTells ? `, on ${withTells} clips` : ''}.` : `On ${pipelines[n] ?? 0} of ${withTells} clips with tells.`,
            })),
          ),
        ],
    };
  }, [pipelines]);

  useDevSection(() => {
    const item = (id: PaletteId) => ({ label: PALETTES[id].name, value: id, note: PALETTES[id].blurb });
    return {
      id: 'colors/palette',
      tab: 'colors',
      rows: [
        {
          kind: 'choice',
          id: 'palette',
          label: 'Palette',
          items: PALETTE_IDS.filter((id) => !LEGACY_PALETTES.includes(id)).map(item),
          value: palette.id,
          defaultValue: DEFAULT_PALETTE,
          onSelect: (v) => setPalette(v as PaletteId),
        },
        // The old look, apart, to compare against.
        {
          kind: 'choice',
          id: 'legacy',
          label: 'Legacy',
          items: LEGACY_PALETTES.map(item),
          value: palette.id,
          onSelect: (v) => setPalette(v as PaletteId),
          display: 'chips',
        },
      ],
    };
  }, [palette.id]);

  useDevSection(
    () => ({
      id: 'flows/screens',
      tab: 'flows',
      title: 'Open',
      note: 'Jump straight into a screen or sheet.',
      rows: [
        ...(onShowLanding
          ? [{ kind: 'action' as const, label: 'Landing page', note: 'The web’s front page, with its design bar.', run: () => (closeDevSettings(), onShowLanding()) }]
          : []),
        { kind: 'action', label: 'Sign-in sheet', note: 'As a guest’s first like or comment opens it.', run: () => (closeDevSettings(), openSignIn()) },
        { kind: 'action', label: 'Settings', run: () => (closeDevSettings(), openSettings()) },
      ],
    }),
    [onShowLanding],
  );

  return null;
}
