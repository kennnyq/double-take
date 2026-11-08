import type { Clip } from '../data/clips.ts';

export type RealClipMode = 'toast' | 'hideEye';
type Explanation = { kind: 'none' | 'walkthrough' } | { kind: 'toast'; text: string };

/** Shared by rail, pointer gestures and Space. Game keeps its existing rules. */
export function clipExplanation(clip: Pick<Clip, 'verdict' | 'tellsUrl' | 'author' | 'sourceUrl'>, realClips: RealClipMode, game = false): Explanation {
  if (game) return { kind: clip.tellsUrl ? 'walkthrough' : 'none' };
  if (clip.verdict === 'real') {
    if (realClips === 'hideEye') return { kind: 'none' };
    const source = clip.sourceUrl && clip.author && !['unknown', 'x', 'youtube', 'reddit', 'tiktok'].includes(clip.author);
    return { kind: 'toast', text: source ? `Real · from @${clip.author}` : "This one's real" };
  }
  return clip.tellsUrl ? { kind: 'walkthrough' } : { kind: 'toast', text: 'No walkthrough for this clip yet' };
}
