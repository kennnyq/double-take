import type { SectionId } from './timeline';

export interface SectionWords {
  /** The tab it shows, as the index names it. */
  name: string;
  title: string;
  body: string;
}

export const SECTION_WORDS: Record<SectionId, SectionWords> = {
  scroll: {
    name: 'Scroll',
    title: 'Look again.',
    body: 'Hold or double tap any clip. The walkthrough steps through what gives it away, one moment at a time.',
  },
  upload: {
    name: 'Upload',
    title: 'Check your own.',
    body: 'Drop in a video or paste a link. See what it finds, part by part.',
  },
  game: {
    name: 'Game',
    title: 'Spot the AI.',
    body: 'Call each clip, real or AI, and find out right away. No timer.',
  },
  skills: {
    name: 'Skills',
    title: 'See what you catch.',
    body: 'A score for each kind of tell, worked out from your answers. It gets sharper as you play.',
  },
  account: {
    name: 'Profile',
    title: 'Keep what you find.',
    body: 'Your likes, reposts and saves, on any device. Or start as a guest.',
  },
};
