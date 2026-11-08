/**
 * Keeping the answer out of the round: a clip shown in the game carries no
 * verdict, tier, evidence or tells (the feed's clip page shows a verdict
 * badge and a Double take button from those), and its caption and handle
 * lose anything that names AI, real footage or a video generator. Pure, for
 * `node --test`.
 */
import type { Clip } from '../data/clips.ts';

/** Words that give a clip's verdict away, or point at it. */
const LEAK = new RegExp(
  [
    String.raw`\bai\b`,
    String.raw`\ba\.i\.?`,
    String.raw`#ai\w*`,
    String.raw`\bartificial`,
    String.raw`\bgenerat(ed|ive|or|ion)\b`,
    String.raw`\bgen[- ]?ai\b`,
    String.raw`\b(sora|veo|kling|runway|midjourney|pika|luma|hailuo|minimax|wan ?2|seedance|dall-?e|stable diffusion|grok imagine)\b`,
    String.raw`\bdeep ?fakes?\b`,
    String.raw`\bfake\b`,
    String.raw`\bcgi\b`,
    String.raw`\bsynthetic\b`,
    String.raw`\brendered\b`,
    String.raw`\breal\b`,
    String.raw`\bauthentic\b`,
    String.raw`\bis ?this ?ai\b`,
    String.raw`\bisthisai\b`,
    String.raw`\bcommunity notes?\b`,
  ].join('|'),
  'i',
);

export function leaks(text: string | undefined): boolean {
  return !!text && LEAK.test(text.replace(/_/g, ' '));
}

/**
 * A caption without the parts that would give the answer: sentences and
 * hashtags that name AI, real footage or a generator are dropped; what's left
 * stays as written. Empty if nothing safe is left.
 */
export function safeCaption(caption: string): string {
  const parts = caption.split(/(?<=[.!?])\s+|\s+(?=#)/);
  return parts
    .filter((p) => !leaks(p))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A handle that names AI or the like ("ai_creations", "r_isthisai") becomes a neutral, stable stand-in. */
export function safeHandle(author: string): string {
  if (!leaks(author)) return author;
  let h = 0;
  for (const c of author) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `creator_${(h % 9000) + 1000}`;
}

/**
 * The clip as the game may show it. A clip whose handle gives it away (posts
 * from an is-this-AI forum, AI art accounts) loses its caption too: there the
 * title is people arguing over whether it's fake.
 */
export function safeClip(clip: Clip): Clip {
  return {
    ...clip,
    caption: leaks(clip.author) ? '' : safeCaption(clip.caption),
    author: safeHandle(clip.author),
    verdict: undefined,
    verdictTier: undefined,
    verdictEvidence: undefined,
    tellsUrl: undefined,
    tellsVariants: undefined,
    sourceUrl: undefined,
  };
}
