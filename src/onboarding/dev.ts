import { registerDevSection } from '@/devtools/api';
import { closeDevSettings, DEV_TOOLS } from '@/devtools/store';
import { DEV_DEFAULTS, hints, type HintState } from './store';

/*
 * Dev settings → Interaction → Gesture hint: pick a design and the input it
 * shows, play it now, keep it on every clip to compare, or start over as a
 * brand-new viewer. Registered again whenever the hints' state changes, so the
 * rows show it live.
 */

function register(s: HintState) {
  const { seen } = s.progress;
  // On phones the panel covers the clip: close it so the hint can be seen.
  const play = () => {
    closeDevSettings();
    hints.showNow();
  };
  registerDevSection({
    id: 'interaction/gesture-hint',
    tab: 'interaction',
    title: 'Gesture hint',
    order: -10,
    note: `The first-run hint over the feed. ${seen ? 'Already seen; remembered for signed-in viewers.' : 'Not yet seen for half a second.'} Signed-out visitors see it again on refresh.`,
    keywords: 'tutorial hint onboarding first run gesture design style',
    rows: [
      {
        kind: 'choice',
        id: 'design',
        label: 'Design',
        items: [
          { label: 'Hand', value: 'hand', note: 'A hand with a soft drop shadow; taps ripple, a hold fills a ring.' },
          { label: 'Finger', value: 'finger', note: 'A drawn fingertip pressing in, with its shadows, the ripples and ring.' },
          { label: 'Fingertip', value: 'fingertip', note: 'The same finger with only its contact shadow and a pressed glow that swells as it holds.' },
        ],
        value: s.design,
        defaultValue: DEV_DEFAULTS.design,
        onSelect: (v) => hints.setDesign(v as HintState['design']),
      },
      {
        kind: 'choice',
        id: 'input',
        label: 'Input',
        items: [
          { label: 'Auto', value: 'auto', note: 'The same hand everywhere; with a fine pointer the words say hold spacebar or double click.' },
          { label: 'Touch', value: 'touch' },
          { label: 'Mouse', value: 'mouse' },
          { label: 'Still', value: 'still', note: 'As with Reduce Motion on: a still icon and its caption.' },
        ],
        value: s.input,
        defaultValue: DEV_DEFAULTS.input,
        onSelect: (v) => hints.setInput(v as HintState['input']),
      },
      { kind: 'action', id: 'show', label: 'Show now', note: 'Closes this and plays the hint on the clip, for the gesture setting.', run: play },
      {
        kind: 'switch',
        id: 'repeat',
        label: 'Keep showing',
        note: 'On every clip with a double take, looping, to compare designs.',
        value: s.force === 'doubleTake',
        defaultValue: false,
        onChange: (on) => hints.setForce(on ? 'doubleTake' : 'off'),
      },
      { kind: 'action', id: 'reset', label: 'Reset tutorial', note: 'Hints show again as for a brand-new viewer.', run: hints.reset },
    ],
  });
}

if (DEV_TOOLS) {
  let last: HintState | null = null;
  const sync = () => {
    const s = hints.getSnapshot();
    // Session changes (clips, tries) don't change the rows.
    if (last && last.progress === s.progress && last.force === s.force && last.design === s.design && last.input === s.input) return;
    last = s;
    register(s);
  };
  sync();
  hints.subscribe(sync);
}
