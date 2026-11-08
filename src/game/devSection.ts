import { router } from 'expo-router';
import { registerDevSection, registerDevTab } from '@/devtools/api';
import type { DevRow } from '@/devtools/registry';
import { DEV_TOOLS, closeDevSettings } from '@/devtools/store';
import { GAME_DESIGNS, GAME_ELEMENTS } from './designs';
import { ROUND_LENGTHS, gameDev, setGameDesign } from './devOptions';
import { gameIntro } from './intro';
import { gameHistory } from './store';
import { RankerReadout } from '@/engagement/RankerReadout';
import { signals } from '@/engagement/store';
import { skillStore } from '@/skills/store';

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
      kind: 'switch',
      id: 'adaptive',
      label: 'Adaptive difficulty',
      note: 'Deal clips you should get right about two times in three, from your skills. Off: a plain shuffle.',
      value: s.adaptive,
      defaultValue: gameDev.defaults.adaptive,
      onChange: (v) => gameDev.set({ adaptive: v }),
    },
    {
      kind: 'switch',
      id: 'review',
      label: 'Learn from clips looked back at',
      note: 'Game tab: scrolling back to a clip already judged opens its double take.',
      value: s.review,
      defaultValue: gameDev.defaults.review,
      onChange: (v) => gameDev.set({ review: v }),
    },
    {
      kind: 'action',
      label: 'Show the Game intro again',
      run: () => gameIntro.reset(),
    },
    {
      kind: 'action',
      label: 'Play the timed round',
      note: 'The 60 s demo round. The Game tab plays untimed.',
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
    {
      kind: 'action',
      label: 'Reset skills',
      note: 'Skill scores and every clip’s learned difficulty.',
      tone: 'danger',
      run: () => skillStore.reset(),
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
  registerDevSection({
    id: 'game/ranker',
    tab: 'game',
    title: 'Feed ranker',
    note: 'A proof of concept of a For You order from what you do on this device (likes, saves, shares, game answers). Applies on the next load.',
    order: 20,
    rows: [
      {
        kind: 'switch',
        id: 'rankFeed',
        label: 'Rank the feed',
        value: gameDev.getSnapshot().rankFeed,
        defaultValue: gameDev.defaults.rankFeed,
        onChange: (v) => gameDev.set({ rankFeed: v }),
      },
      { kind: 'action', label: 'Forget what I engaged with', tone: 'danger', run: () => signals.reset() },
    ],
    Component: RankerReadout,
    keywords: 'ranker engagement feed order why for you algorithm',
  });
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
