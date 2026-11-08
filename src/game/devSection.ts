import { router } from 'expo-router';
import { registerDevSection, registerDevTab } from '@/devtools/api';
import type { DevRow } from '@/devtools/registry';
import { DEV_TOOLS, closeDevSettings } from '@/devtools/store';
import { ROUND_LENGTHS, gameDev } from './devOptions';
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

function register() {
  registerDevSection({ id: 'game/round', tab: 'game', title: 'Timed guessing', rows: rows(), keywords: 'game round timer score play' });
}

if (DEV_TOOLS) {
  registerDevTab({ id: 'game', label: 'Game', icon: 'timer-outline', order: 45 });
  register();
  gameDev.subscribe(register);
}
