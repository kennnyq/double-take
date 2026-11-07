/**
 * Stage 1: a text model reads the Community Note and comments and lists the
 * concrete tells they claim. Everything it returns is checked against the
 * input text, because a claim we can't trace to a person's words is the model
 * talking, not the community.
 */
import { CATEGORY_ENUM, categoryFromText, normalizeCategory, type Category } from './categories.ts';
import { extractJson } from './modelJson.ts';
import { mentionsTime, parseTime } from './timing.ts';

export type Stance = 'claims_ai' | 'staged_or_fake' | 'says_real' | 'other';
const STANCES: Stance[] = ['claims_ai', 'staged_or_fake', 'says_real', 'other'];

/** One piece of text the model reads. `ref` is how the model cites it. */
export interface SourceText {
  ref: string; // "note" or "comment:3"
  kind: 'community_note' | 'comment';
  text: string;
  url?: string;
  author?: string;
}

export interface Claim {
  id: string;
  ref: string;
  quote: string;
  category: Category;
  description: string;
  /** Seconds, only when the source text itself names a time. */
  t0: number | null;
  t1: number | null;
  regionHint: string | null;
}

export interface ClaimsResult {
  stance: Stance;
  rationale: string;
  claims: Claim[];
  /** Per-comment stance, so comments saying "this is real" are reported, not dropped. */
  commentStances: Record<string, Stance>;
  issues: string[];
}

export const MAX_CLAIMS = 8;

/** Schema sent as `guided_json`. `rationale` comes first on purpose: it measurably reduced mislabels in the PoC. */
export const CLAIMS_SCHEMA = {
  type: 'object',
  properties: {
    rationale: { type: 'string', maxLength: 300 },
    stance: { type: 'string', enum: STANCES },
    claims: {
      type: 'array',
      maxItems: MAX_CLAIMS,
      items: {
        type: 'object',
        properties: {
          source_ref: { type: 'string' },
          quote: { type: 'string', maxLength: 240 },
          category: { type: 'string', enum: CATEGORY_ENUM },
          description: { type: 'string', maxLength: 200 },
          time_s: { type: ['number', 'null'] },
          end_s: { type: ['number', 'null'] },
          region_hint: { type: ['string', 'null'] },
        },
        required: ['source_ref', 'quote', 'category', 'description', 'time_s', 'end_s', 'region_hint'],
      },
    },
    comment_stances: {
      type: 'array',
      items: {
        type: 'object',
        properties: { source_ref: { type: 'string' }, stance: { type: 'string', enum: STANCES } },
        required: ['source_ref', 'stance'],
      },
    },
  },
  required: ['rationale', 'stance', 'claims', 'comment_stances'],
} as const;

export const CLAIMS_SYSTEM = `You read crowd-sourced notes and comments about one social-media video and list the concrete tells they claim show it is AI-generated.
Rules:
- Use only what the texts say. Never add tells of your own. If a text names no concrete tell, list nothing for it.
- One claim per artifact: "the dresser disappears and the fire alarm vanishes" is two claims, each with its own quote.
- quote: copy the exact words from the text that make the claim.
- source_ref: the ref of the text you quoted, without brackets (e.g. note, comment:2).
- time_s / end_s: seconds from the start only when the text gives a time ("0:07" -> 7, "~2s" -> 2); otherwise null.
- region_hint: where in the frame, in the text's own words ("top-right", "highway sign"), else null.
- Generic reasons (video length, "looks fake", news reports) are not tells.
stance: claims_ai = the texts say the video is AI-generated; staged_or_fake = staged or misleading but not AI; says_real = real footage, not AI; other.
comment_stances: one entry per comment.`;

export function claimsPrompt(sources: SourceText[]): string {
  return sources.map((s) => `[${s.ref}] (${s.kind === 'community_note' ? 'Community Note' : 'comment'})\n${s.text}`).join('\n\n');
}

/** Lowercase, decode the entities the notes dump leaves in, and squash punctuation and spaces. */
export function normalizeText(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, '')
    .replace(/[^\p{L}\p{N}:]+/gu, ' ')
    .trim();
}

/** Is `quote` taken from `source`? Exact (normalized) substring, or ≥ 85% of its words in order-insensitive form. */
export function quoteMatches(quote: string, source: string): 'exact' | 'close' | false {
  const q = normalizeText(quote);
  const s = normalizeText(source);
  if (!q) return false;
  if (s.includes(q)) return 'exact';
  const words = q.split(' ').filter((w) => w.length > 2);
  if (words.length < 3) return false;
  const have = new Set(s.split(' '));
  const hit = words.filter((w) => have.has(w)).length;
  return hit / words.length >= 0.85 ? 'close' : false;
}

/** "This video is AI generated content", "AI-generated (Sora-style)": a verdict, not something to look at. */
export function isGenericClaim(quote: string): boolean {
  const q = normalizeText(quote).replace(/\b(this|the|video|clip|is|an?|entirely|content|footage|it|s|style|sora|veo)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(ai generated|ai|generated by ai|made with ai|fake|not real)?$/.test(q);
}

export function validateClaims(reply: unknown, sources: SourceText[]): ClaimsResult {
  const issues: string[] = [];
  const { value, repairs } = extractJson(reply);
  issues.push(...repairs.map((r) => `json: ${r}`));
  const d = value as Record<string, unknown>;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('claims reply is not a JSON object');

  let stance = d.stance as Stance;
  if (!STANCES.includes(stance)) {
    issues.push(`unknown stance ${JSON.stringify(d.stance)}; using "other"`);
    stance = 'other';
  }
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const claims: Claim[] = [];
  const list = Array.isArray(d.claims) ? d.claims : [];
  if (!Array.isArray(d.claims)) issues.push('no claims array');

  for (const [i, raw] of list.entries()) {
    const c = raw as Record<string, unknown>;
    const quote = typeof c?.quote === 'string' ? c.quote.trim() : '';
    const description = typeof c?.description === 'string' ? c.description.trim() : '';
    if (!quote || !description) {
      issues.push(`claim ${i}: missing quote or description; dropped`);
      continue;
    }
    if (isGenericClaim(quote)) {
      issues.push(`claim ${i}: "${quote.slice(0, 60)}" is a verdict, not a tell; dropped`);
      continue;
    }
    // The cited source must contain the quote; if the ref is wrong, look for the right one.
    let src = byRef.get(String(c.source_ref).trim().replace(/^\[|\]$/g, ''));
    let match = src ? quoteMatches(quote, src.text) : false;
    if (!match) {
      const found = sources.find((s) => quoteMatches(quote, s.text));
      if (!found) {
        issues.push(`claim ${i}: quote "${quote.slice(0, 60)}" is not in any input text; dropped`);
        continue;
      }
      issues.push(`claim ${i}: quote found in ${found.ref}, not ${String(c.source_ref)}; re-attributed`);
      src = found;
      match = quoteMatches(quote, found.text);
    }
    if (match === 'close') issues.push(`claim ${i}: quote is close to, not exactly, the source wording`);

    // Times must come from the people, not the model.
    let t0 = parseTime(c.time_s);
    let t1 = parseTime(c.end_s);
    if ((t0 !== null || t1 !== null) && !mentionsTime(src!.text)) {
      issues.push(`claim ${i}: time ${t0}s isn't in ${src!.ref}; removed`);
      t0 = t1 = null;
    }
    const dup = claims.find((k) => k.ref === src!.ref && normalizeText(k.quote) === normalizeText(quote) && k.description === description);
    if (dup) {
      issues.push(`claim ${i}: duplicate; dropped`);
      continue;
    }
    if (claims.length >= MAX_CLAIMS) {
      issues.push(`claim ${i}: more than ${MAX_CLAIMS} claims; dropped`);
      continue;
    }
    // The person's own words beat the model's label ("arm morphs into a leg" isn't "text").
    let category = normalizeCategory(c.category);
    const cue = categoryFromText(quote);
    if (cue && cue !== category) {
      issues.push(`claim ${i}: category ${category} → ${cue} from the quote`);
      category = cue;
    }
    claims.push({
      id: `c${claims.length + 1}`,
      ref: src!.ref,
      quote,
      category,
      description,
      t0,
      t1,
      regionHint: typeof c.region_hint === 'string' && c.region_hint.trim() ? c.region_hint.trim() : null,
    });
  }

  const commentStances: Record<string, Stance> = {};
  for (const cs of Array.isArray(d.comment_stances) ? d.comment_stances : []) {
    const r = cs as { source_ref?: unknown; stance?: unknown };
    const ref = typeof r?.source_ref === 'string' ? r.source_ref.trim().replace(/^\[|\]$/g, '') : '';
    if (ref.startsWith('comment:') && byRef.has(ref) && STANCES.includes(r.stance as Stance)) {
      commentStances[ref] = r.stance as Stance;
    }
  }
  return { stance, rationale: typeof d.rationale === 'string' ? d.rationale : '', claims, commentStances, issues };
}
