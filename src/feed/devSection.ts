import { Platform } from 'react-native';
import { registerDevSection, settingChoice, settingSwitch } from '@/devtools/api';

/*
 * The double take's dev options (spotlight effect, strength and shape, and a
 * reviewer marker for model drafts), on the Interaction tab next to the hold
 * length. Registered when the overlay loads.
 */
registerDevSection({
  id: 'double-take',
  tab: 'interaction',
  title: 'Double take',
  note: 'The spotlight on each tell: everything outside its area. Cheapest first; darken is the default.',
  keywords: 'spotlight darken blur dim shape ellipse circle feather blob strength draft performance',
  order: 20,
  rows: (s) => [
    settingChoice(s, 'spotlightEffect', 'Spotlight', [
      { label: 'Off', value: 'off', note: 'No spotlight: just the card.' },
      { label: 'Darken', value: 'darken', note: 'Dims outside the area. Cheap everywhere.' },
      {
        label: 'Cheap blur',
        value: 'cheapBlur',
        note:
          Platform.OS === 'web'
            ? 'Dims over a blurred still of the loop; the area stays live.'
            : 'Dims over a blurred still of the loop (blurred once per tell); the area stays live.',
      },
      {
        label: 'Full blur',
        value: 'fullBlur',
        note:
          Platform.OS === 'android'
            ? 'Live blur over the playing video (dims only on Android).'
            : 'Live blur over the playing video. Slow on iPhones; for comparison.',
      },
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
      { label: 'Blob', value: 'blob', note: 'A roomy soft oval with a very soft edge.' },
    ]),
    settingChoice(s, 'spotlightPadding', 'Room around the tell', [
      { label: 'Tight', value: 'tight', note: 'Close around the tell’s box.' },
      { label: 'Normal', value: 'normal', note: 'A comfortable margin around the box; the card keeps clear of it.' },
      { label: 'Roomy', value: 'roomy', note: 'Plenty of context around the box.' },
    ]),
    settingSwitch(s, 'markDrafts', 'Mark model drafts', 'Reviewers: adds “AI draft” under unreviewed tells. Never shown by default.'),
  ],
});

/* Temporary: switch pieces of the double take off one at a time, to find what closes Expo Go on entry. */
registerDevSection({
  id: 'double-take-check',
  tab: 'interaction',
  title: 'Double take: crash check',
  note: 'Temporary. If the app closes when the double take opens, turn these off one at a time (and Spotlight → Off above) and say which one stops it.',
  keywords: 'crash debug diagnose bisect',
  order: 21,
  rows: (s) => [
    settingSwitch(s, 'dbgCornerCaps', 'Rounded corners', 'The black caps that round the inset video.'),
    settingSwitch(s, 'dbgLineText', 'Line-by-line text', 'Off: the card’s text fades in as one block.'),
    settingSwitch(s, 'dbgScrub', 'Fast-forward to tells', 'Off: goes straight to each tell (for this check only).'),
  ],
});
