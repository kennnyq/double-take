/**
 * The feed modes as the viewer sees them. Pure, so it runs under `node --test`.
 *
 * The reveal's wording follows the dev setting for how the double take opens
 * (hold or double tap), so the copy never promises a gesture that does
 * something else.
 */
import type { RevealGesture } from '../devtools/settings.ts';
import type { FeedMode } from './settings.ts';

export interface FeedModeOption {
  id: FeedMode;
  title: string;
  description: string;
  /** An Ionicons name. */
  icon: 'eye-off-outline' | 'pricetag-outline' | 'sparkles-outline' | 'videocam-outline';
}

/** "Hold", "Double-tap", "Click and hold" or "Double-click". */
export function revealVerb(gesture: RevealGesture, desktop: boolean): string {
  if (gesture === 'hold') return desktop ? 'Click and hold' : 'Hold';
  return desktop ? 'Double-click' : 'Double-tap';
}

export function feedModeOptions(gesture: RevealGesture, desktop: boolean): FeedModeOption[] {
  const verb = revealVerb(gesture, desktop);
  return [
    {
      id: 'default',
      title: 'Default',
      description: `No labels. ${verb} a clip to see the AI verdict and the reasoning.`,
      icon: 'eye-off-outline',
    },
    {
      id: 'autoLabel',
      title: 'Auto label',
      description: `Every clip says AI or Not AI up front. ${verb} to see the reasoning.`,
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
