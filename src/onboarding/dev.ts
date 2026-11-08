import { registerDevSection } from '@/devtools/api';
import { DEV_TOOLS } from '@/devtools/store';
import { OPENS_TO_LEARN } from './hints';
import { hints, type HintState } from './store';

/*
 * Dev settings → Interaction → Tutorial: force a hint on every clip, pick how
 * it draws, or start over as a brand-new viewer. Registered again whenever the
 * hints' state changes, so the rows show it live.
 */

function register(s: HintState) {
  const { opens, swiped } = s.progress;
  registerDevSection({
    id: 'interaction/tutorial',
    tab: 'interaction',
    title: 'Tutorial',
    order: 20,
    note: `Double takes opened: ${opens} of ${OPENS_TO_LEARN}. Swipe ${swiped ? 'learned' : 'not learned yet'}.`,
    keywords: 'hint onboarding first run gesture swipe',
    rows: [
      {
        kind: 'choice',
        id: 'force',
        label: 'Show',
        items: [
          { label: 'Normally', value: 'off', note: 'Swipe once, then the gesture until two double takes are opened.' },
          { label: 'Swipe', value: 'swipe', note: 'The swipe hint on every clip (phone layout).' },
          { label: 'Gesture', value: 'doubleTake', note: 'The double take hint on every clip with tells, looping.' },
        ],
        value: s.force,
        defaultValue: 'off',
        onSelect: (v) => hints.setForce(v as HintState['force']),
      },
      {
        kind: 'choice',
        id: 'style',
        label: 'Style',
        items: [
          { label: 'Auto', value: 'auto', note: 'A hand on touch screens; mouse and keyboard with a fine pointer.' },
          { label: 'Touch', value: 'touch' },
          { label: 'Mouse', value: 'mouse' },
          { label: 'Still', value: 'still', note: 'As with Reduce Motion on: a still icon and its caption.' },
        ],
        value: s.style,
        defaultValue: 'auto',
        onSelect: (v) => hints.setStyle(v as HintState['style']),
      },
      { kind: 'action', id: 'reset', label: 'Reset the tutorial', note: 'Hints show as for a brand-new viewer.', run: hints.reset },
    ],
  });
}

if (DEV_TOOLS) {
  let last: HintState | null = null;
  const sync = () => {
    const s = hints.getSnapshot();
    // Session changes (clips, tries) don't change the rows.
    if (last && last.progress === s.progress && last.force === s.force && last.style === s.style) return;
    last = s;
    register(s);
  };
  sync();
  hints.subscribe(sync);
}
