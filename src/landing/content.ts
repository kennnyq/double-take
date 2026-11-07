import type { LandingValues } from './designs';

export interface HeroWords {
  eyebrow: string;
  /** The heading around its key word: before, key word, after. */
  heading: [string, string, string];
  sub: string;
  button: string;
}

export const COPY: Record<LandingValues['copy'], HeroWords> = {
  second: {
    eyebrow: 'Real or AI?',
    heading: ['Take a ', 'second', ' look.'],
    sub: 'Short videos, one swipe at a time. Make your call, then see what gave it away.',
    button: 'Start watching',
  },
  realai: {
    eyebrow: 'A feed that keeps you guessing',
    heading: ['Real or ', 'AI', '?'],
    sub: 'Swipe through short clips and call each one. The tells come after.',
    button: 'Make your call',
  },
  twice: {
    eyebrow: 'Double Take',
    heading: ['Look ', 'twice', '.'],
    sub: 'Generated video is getting good. Your eye can get better.',
    button: 'Take a look',
  },
  fool: {
    eyebrow: 'Real or AI?',
    heading: ['Would this ', 'fool', ' you?'],
    sub: 'Watch, guess, and see the moments that give a clip away.',
    button: 'Test your eye',
  },
  train: {
    eyebrow: 'Double Take',
    heading: ['Train your ', 'eye', ' for AI video.'],
    sub: 'One clip at a time: call it, then step through the tells.',
    button: 'Start training',
  },
  tells: {
    eyebrow: 'Real or AI?',
    heading: ['Learn the ', 'tells', '.'],
    sub: 'Warped hands, melting text, light from nowhere. See what gives generated video away.',
    button: 'Start watching',
  },
};

export const STEPS = [
  { title: 'Watch', body: 'Short clips, full screen, one swipe at a time.' },
  { title: 'Call it', body: 'Real or AI? Decide before you look closer.' },
  { title: 'See the tells', body: 'Step through the moments that give it away, boxed on the frame.' },
];

export const TELLS = [
  { title: 'Hands and edges', body: 'Fingers merge, objects melt into each other.' },
  { title: 'Text', body: 'Signs and labels that almost spell something.' },
  { title: 'Light', body: 'Shadows that disagree with where the light comes from.' },
  { title: 'Physics', body: 'Things that drift, pop or loop when they should not.' },
];
