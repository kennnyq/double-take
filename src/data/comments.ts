/**
 * Deterministic stand-in comments for a clip. Pure and free of React Native
 * imports so it can be unit-tested with `node --test`.
 */

export interface StandInComment {
  id: string;
  clipId: string;
  handle: string;
  text: string;
  /** Minutes since posted. */
  ago: number;
  likes: number;
  /** Total replies the thread claims to have (0–40). */
  replyCount: number;
  isAuthor: boolean;
  /** Top-level comment id for replies, null for top-level comments. */
  parentId: string | null;
}

/** The parts of a clip the generator needs (structurally matches `Clip`). */
export interface CommentSeed {
  id: string;
  author: string;
  likes: number;
}

const HANDLES = [
  'velvet.orbit', 'tinfoil_tess', 'loopwatcher', 'margo.mp4', 'slow_signal', 'ferncore',
  'dusk.relay', 'pixelmoss', 'okay_ollie', 'rue.and.rain', 'static.bloom', 'nightbus_nico',
  'kiln.and.co', 'saltwater.sam', 'paperlantern', 'drift.daily', 'mo_onwalker', 'hazel.hz',
  'quiet_quinn', 'basil.frame', 'tangerine.tv', 'lowpoly.lu', 'cassette.cat', 'ember.ellis',
  'yuzu.yard', 'frame_by_fran', 'glasshouse.g', 'arlo.wav', 'sundial.s', 'pebble.penn',
];

const TEXTS = [
  'Okay I genuinely cannot tell if this is real',
  "What's the song?? It's been stuck in my head all day",
  'part 2?',
  'the loop at 0:04 is so clean I watched it 11 times',
  'This is my new sleep screensaver',
  'Generated. Has to be. Look at the edges at 0:06',
  'No way this is real… right??',
  'I could stare at this for an hour',
  'Saving this for exam week 🙏',
  'the colors are actually unreal',
  'How long did this take to render?',
  "Watched it 6 times trying to find the seam. Couldn't.",
  'this feels like a dream I had once',
  'Real or not, it calmed me down',
  '🔥🔥🔥',
  '😮',
  'Song name please 🙏',
  'Petition for a 10 hour version',
  '0:03 is where it gets me every time',
  'Why does this make me nostalgic for a place I have never been',
  'This deserves way more views',
  'teach me your ways',
  "I guessed real. I'm never guessing again",
  'the way it loops perfectly ✨',
  'putting this on the big TV tonight',
  'my eyes keep looking for the cut',
  'The ambient audio on this is perfect',
  'who else is here at 3am',
  'This is the content I signed up for',
  'Is there a longer cut of this anywhere?',
  "Okay but what camera (or model) is this",
  'reminds me of the ocean at night',
  'Showed this to my mom and she said "that\'s fake" in 0.2 seconds',
  'Instant follow',
  '😍😍',
  'brain: real. eyes: generated. heart: who cares',
  'The lighting at the end 🤌',
  'Can you do one with rain next?',
  'I need this as a live wallpaper',
  'Every time I scroll past I come back',
];

const AUTHOR_TEXTS = [
  'Thanks for all the guesses! Answer is in my next Take 👀',
  'Song is linked in the sound — it\'s an original loop',
  'Part 2 is rendering right now, promise',
  'Pinned: no, the colors are not edited. Make of that what you will',
];

const REPLY_TEXTS = [
  'same here', 'right?? 😭', 'it\'s in the sound link', 'this. exactly this.', 'agreed 100%',
  'I thought the same thing', 'lol', 'no because why is this so true', 'nah it\'s real, look at the shadows',
  'it\'s generated, the water gives it away', 'following for the answer', '😂😂', 'came here to say this',
  'look at 0:05 again', 'part 2 when', 'okay you convinced me',
];

/** FNV-1a 32-bit string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32): returns floats in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], r: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const MINUTES_IN_8_WEEKS = 60 * 24 * 56;

/** 12–20 top-level comments for a clip, the same every time for the same clip. */
export function makeComments(clip: CommentSeed): StandInComment[] {
  const r = rng(hash(clip.id));
  const n = 12 + Math.floor(r() * 9);
  const handles = shuffled(
    HANDLES.filter((h) => h !== clip.author),
    r,
  );
  const texts = shuffled(TEXTS, r);
  const topLikes = Math.max(60, Math.round(clip.likes * (0.004 + r() * 0.012)));
  const authorFirst = r() < 0.4;
  const out: StandInComment[] = [];
  for (let i = 0; i < n; i++) {
    const isAuthor = authorFirst && i === 0;
    const replyRoll = r();
    const replyCount = replyRoll < 0.45 ? 0 : 1 + Math.floor(r() * r() * 40);
    out.push({
      id: `${clip.id}-c${i}`,
      clipId: clip.id,
      handle: isAuthor ? clip.author : handles[i % handles.length],
      text: isAuthor ? AUTHOR_TEXTS[Math.floor(r() * AUTHOR_TEXTS.length)] : texts[i % texts.length],
      ago: 20 + Math.floor(r() * MINUTES_IN_8_WEEKS),
      likes: Math.max(0, Math.round(topLikes * Math.pow(0.7, i) * (0.75 + r() * 0.5))),
      replyCount: Math.min(40, replyCount),
      isAuthor,
      parentId: null,
    });
  }
  return out;
}

/** Up to `max` stand-in replies for a top-level comment (fewer if it has fewer). */
export function makeReplies(parent: StandInComment, clipAuthor: string, max = 3): StandInComment[] {
  const n = Math.min(max, parent.replyCount);
  const r = rng(hash(parent.id + '/replies'));
  const handles = shuffled(
    HANDLES.filter((h) => h !== parent.handle && h !== clipAuthor),
    r,
  );
  const texts = shuffled(REPLY_TEXTS, r);
  const out: StandInComment[] = [];
  for (let i = 0; i < n; i++) {
    // Now and then the clip's author chimes in on the first reply.
    const isAuthor = i === 0 && !parent.isAuthor && r() < 0.2;
    const mention = r() < 0.35 ? `@${parent.handle} ` : '';
    out.push({
      id: `${parent.id}-r${i}`,
      clipId: parent.clipId,
      handle: isAuthor ? clipAuthor : handles[i % handles.length],
      text: mention + texts[i % texts.length],
      ago: Math.max(1, Math.floor(parent.ago * (0.2 + r() * 0.75))),
      likes: Math.round(parent.likes * (0.01 + r() * 0.06)),
      replyCount: 0,
      isAuthor,
      parentId: parent.id,
    });
  }
  return out;
}

/** "now", "5m", "17h", "2d", "5w". */
export function formatAgo(minutes: number): string {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 7)}w`;
}
