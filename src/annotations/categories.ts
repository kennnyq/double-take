/** Tell categories shared by the pipeline and the app. */
export const CATEGORIES = [
  'anatomy',
  'object_morph',
  'physics',
  'text',
  'watermark',
  'background_shift',
  'continuity',
  'lighting',
  'audio',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

const SYNONYMS: [RegExp, Category][] = [
  [/anatom|morphing_anatomy|hand|finger|limb|face|teeth|eye|body|arm|leg|foot|feet|paw|nail|mouth/, 'anatomy'],
  [/text|garbl|letter|sign|caption|licen[cs]e/, 'text'],
  [/watermark|logo/, 'watermark'],
  [/audio|voice|sound|speech/, 'audio'],
  [/light|shadow|reflect/, 'lighting'],
  [/background|wall|scene_shift/, 'background_shift'],
  [/physic|gravity|motion|clip_through|pass(es)? through/, 'physics'],
  [/appear|vanish|disappear|continu/, 'continuity'],
  [/morph|object|transform/, 'object_morph'],
];

/** Map whatever a model wrote ("garbled_text", "object appearing/disappearing") to a category. */
export function normalizeCategory(v: unknown): Category {
  if (typeof v !== 'string') return 'other';
  const s = v.trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if ((CATEGORIES as readonly string[]).includes(s)) return s as Category;
  for (const [re, cat] of SYNONYMS) if (re.test(s)) return cat;
  return 'other';
}

/** Clear category words in a person's own claim ("arm", "garbled", "logo", "voice"). */
const TEXT_CUES: [RegExp, Category][] = [
  [/\b(arms?|legs?|foot|feet|hands?|fingers?|fingernails?|nails?|paws?|limbs?|faces?|teeth|eyes?|mouths?|hair)\b/i, 'anatomy'],
  [/\b(garbled|gibberish|misspel\w*|nonsensical text|text|letters|signs?|licen[cs]e plates?)\b/i, 'text'],
  [/\b(watermark|logo)\b/i, 'watermark'],
  [/\b(voice|audio|sound|hoof sounds?)\b/i, 'audio'],
  [/\b(shadows?|reflections?|lighting)\b/i, 'lighting'],
  [/\b(disappears?|vanish(es)?|appears?|reappears?)\b/i, 'continuity'],
  [/\b(physics|gravity|passes? through|floats?)\b/i, 'physics'],
];

/** The category a claim's own words point to, or null when they don't clearly name one. */
export function categoryFromText(text: string): Category | null {
  for (const [re, cat] of TEXT_CUES) if (re.test(text)) return cat;
  return null;
}

/** JSON-schema enum for prompts (models are asked for these names). */
export const CATEGORY_ENUM: string[] = [...CATEGORIES];
