import { Platform } from 'react-native';
import { registerDevSection, settingChoice } from '@/devtools/api';

/*
 * The double take's dev options (spotlight effect, strength and shape), on the
 * Interaction tab next to the hold length. Registered when the overlay loads.
 */
registerDevSection({
  id: 'double-take',
  tab: 'interaction',
  title: 'Double take',
  note: 'The spotlight on each tell: everything outside its area. It eases between areas.',
  keywords: 'spotlight darken blur dim shape ellipse circle feather blob strength',
  order: 20,
  rows: (s) => [
    settingChoice(s, 'spotlight', 'Spotlight', [
      { label: 'Darken', value: 'darken', note: 'Dims outside the area.' },
      {
        label: 'Blur',
        value: 'blur',
        note: Platform.OS === 'android' ? 'Blurs outside the area (dims instead on Android for now).' : 'Blurs outside the area.',
      },
      { label: 'Both', value: 'both', note: 'Dims and blurs outside the area.' },
    ]),
    settingChoice(s, 'spotlightStrength', 'Strength', [
      { label: 'Light', value: 1 },
      { label: 'Medium', value: 2 },
      { label: 'Strong', value: 3 },
    ]),
    settingChoice(s, 'spotlightShape', 'Shape', [
      { label: 'Rectangle', value: 'rect', note: 'The tell’s box, hard edged.' },
      { label: 'Rounded', value: 'rounded', note: 'A rounded rectangle with a slightly soft edge.' },
      { label: 'Ellipse', value: 'ellipse', note: 'An ellipse through the box’s corners, soft edged.' },
      { label: 'Circle', value: 'circle', note: 'A circle around the whole box.' },
      { label: 'Feathered', value: 'feather', note: 'A padded rounded rectangle that fades out.' },
      { label: 'Blob', value: 'blob', note: 'A roomy capsule with a very soft edge.' },
    ]),
  ],
});
