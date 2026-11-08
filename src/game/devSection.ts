import { router } from 'expo-router';
import { registerDevSection, registerDevTab } from '@/devtools/api';
import type { DevRow } from '@/devtools/registry';
import { DEV_TOOLS, closeDevSettings } from '@/devtools/store';
import { GAME_DESIGNS, GAME_ELEMENTS } from './designs';
import { ROUND_LENGTHS, gameDev, setGameDesign } from './devOptions';
import { gameHistory } from './store';

/*
 * Dev settings → Game: a shorter round to reach the end quickly, a corner
 * label with each clip's truth, and shortcuts. The rows read the game's own
 * dev store, so the section registers again whenever that changes.
 */

function rows(): DevRow[] {
  const s = gameDev.getSnapshot();
  return [
    {
      kind: 'choice',
      id: 'roundMs',
      label: 'Round length',
      items: ROUND_LENGTHS.map((ms) => ({ label: `${ms / 1000} s`, value: ms })),
      value: s.roundMs,
      defaultValue: gameDev.defaults.roundMs,
      onSelect: (v) => gameDev.set({ roundMs: Number(v) }),
    },
    {
      kind: 'switch',
      id: 'showTruth',
      label: 'Show the truth',
      note: 'A corner label with each clip’s answer during the round.',
      value: s.showTruth,
      defaultValue: gameDev.defaults.showTruth,
      onChange: (v) => gameDev.set({ showTruth: v }),
    },
    {
      kind: 'action',
      label: 'Start a round',
      run: () => {
        closeDevSettings();
        router.push('/game');
      },
    },
    {
      kind: 'action',
      label: 'Forget past rounds',
      note: 'Best score, round history and recently dealt clips.',
      tone: 'danger',
      run: () => gameHistory.clear(),
    },
  ];
}

/** One choice row per element of the round, as the game lab picks them. */
function designRows(): DevRow[] {
  const s = gameDev.getSnapshot();
  return GAME_ELEMENTS.map((e) => {
    const info = GAME_DESIGNS[e];
    return {
      kind: 'choice',
      id: `design-${e}`,
      label: info.label,
      items: info.options.map((o) => ({ label: o.label, value: o.id, note: o.note })),
      value: s.designs[e],
      defaultValue: info.default,
      onSelect: (v) => setGameDesign({ [e]: v } as Partial<typeof s.designs>),
    } satisfies DevRow;
  });
}

function register() {
  registerDevSection({ id: 'game/round', tab: 'game', title: 'Timed guessing', rows: rows(), keywords: 'game round timer score play' });
  registerDevSection({
    id: 'game/designs',
    tab: 'game',
    title: 'Designs',
    note: 'Each part of the round on trial. The game lab shows them side by side with fake states.',
    order: 10,
    rows: [
      ...designRows(),
      {
        kind: 'action',
        label: 'Open the game lab',
        run: () => {
          closeDevSettings();
          router.push('/dev/game-lab');
        },
      },
    ],
    keywords: 'design countdown timer transition reveal results expand lab',
  });
}

if (DEV_TOOLS) {
  registerDevTab({ id: 'game', label: 'Game', icon: 'timer-outline', order: 45 });
  register();
  gameDev.subscribe(register);
}
