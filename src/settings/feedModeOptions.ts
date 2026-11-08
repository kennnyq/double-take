/**
 * The feed modes as the viewer sees them. Pure, so it runs under `node --test`.
 *
 * The reveal's wording names the Double take button and the gestures the
 * viewer picked, so the copy never promises a gesture that does something else.
 */
import { revealHow } from './gesture.ts';
import type { FeedMode, RevealGesture } from './settings.ts';

export interface FeedModeOption {
  id: FeedMode;
  title: string;
  description: string;
  /** An Ionicons name. */
  icon: 'eye-off-outline' | 'pricetag-outline' | 'sparkles-outline' | 'videocam-outline';
}

export function feedModeOptions(gesture: RevealGesture, desktop: boolean): FeedModeOption[] {
  const how = revealHow(gesture, desktop);
  const press = desktop ? 'Click' : 'Tap';
  return [
    {
      id: 'default',
      title: 'Default',
      description: `No labels. ${press} Double take, or ${how}, to see the AI verdict and the reasoning.`,
      icon: 'eye-off-outline',
    },
    {
      id: 'autoLabel',
      title: 'Auto label',
      description: `Every clip says AI or Not AI up front. ${press} Double take, or ${how}, for the reasoning.`,
      icon: 'pricetag-outline',
    },
    {
      id: 'onlyAi',
      title: 'Only AI content',
      description: 'Just AI-generated clips. Practice spotting the tells.',
      icon: 'sparkles-outline',
    },
    {
      id: 'onlyReal',
      title: 'Only real content',
      description: 'Just real footage. No AI-generated clips.',
      icon: 'videocam-outline',
    },
  ];
}
