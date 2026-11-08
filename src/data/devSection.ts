import { registerDevSection, settingChoice } from '@/devtools/api';

registerDevSection({
  id: 'feed-order',
  tab: 'interaction',
  title: 'Feed',
  note: 'Applies on reload to Home and the untimed Game. Landing always prefers the best candidates. Pins: DEMO_PINNED_FIRST in src/data/rank.ts.',
  keywords: 'feed order best original ranking demo pins',
  order: 10,
  rows: (s) => [settingChoice(s, 'feedOrder', 'Feed order', [
    { label: 'Best first', value: 'best', note: 'Phone-shaped, short clips with clear, placed tells first. Overrides experimental personalization/adaptive dealing.' },
    { label: 'Original', value: 'original', note: 'The previous feed/deal behavior, including the experimental ranker if enabled.' },
  ])],
});
