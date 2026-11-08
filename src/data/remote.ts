/**
 * Client for the media Worker's feed (worker/README.md) and the mapping from its
 * clips to the app's `Clip` shape. No React Native imports, so it runs under
 * `node --test`.
 */
import type { Clip, Verdict } from './clips';

/** One clip as `/feed` returns it: media fields are signed, absolute URLs. */
export interface RemoteClip {
  id: string;
  video: string;
  poster: string;
  tells: string | null;
  /** Small silent copy for the web landing's gallery (signed URL). */
  tile?: string;
  /** Alternative tells files by pipeline name (signed URLs). */
  tellsAlt?: Record<string, string>;
  width: number;
  height: number;
  duration: number;
  /** Ground truth for the reveal; never shown before the viewer guesses. */
  label?: string | null;
  /** How a real clip is known to be real (harvest tier, e.g. `real-prior`). */
  tier?: string | null;
  /** The note or check behind the label. */
  evidence?: string | null;
  source?: {
    url?: string;
    platform?: string;
    author?: string | null;
    title?: string | null;
    views?: number | null;
    likes?: number | null;
  };
}

export class FeedError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FeedError';
    this.status = status;
  }
}

/** Fetch the signed feed. Throws `FeedError` on HTTP errors, bad JSON or timeout. */
export async function fetchRemoteClips(
  baseUrl: string,
  passcode: string,
  { fetchImpl = fetch, timeoutMs = 8000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RemoteClip[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/feed`, {
      headers: { authorization: `Bearer ${passcode}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new FeedError(`feed request failed (${res.status})`, res.status);
    const body = (await res.json()) as { clips?: unknown };
    if (!Array.isArray(body.clips)) throw new FeedError('feed has no clips array');
    return body.clips.filter(isRemoteClip);
  } catch (e) {
    if (e instanceof FeedError) throw e;
    throw new FeedError(ctrl.signal.aborted ? `feed timed out after ${timeoutMs}ms` : String(e));
  } finally {
    clearTimeout(timer);
  }
}

function isRemoteClip(c: unknown): c is RemoteClip {
  const r = c as RemoteClip;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.video === 'string' &&
    typeof r.poster === 'string' &&
    r.width > 0 &&
    r.height > 0
  );
}

function tellsVariants(r: RemoteClip): Clip['tellsVariants'] {
  const out = r.tells ? [{ name: 'main', url: r.tells }] : [];
  if (r.tellsAlt && typeof r.tellsAlt === 'object') {
    for (const [name, url] of Object.entries(r.tellsAlt)) {
      if (typeof url === 'string' && url && name !== 'main') out.push({ name, url });
    }
  }
  return out.length ? out : undefined;
}

/**
 * The harvest's ground-truth label as a verdict. `confirmed` means confirmed
 * AI-generated (e.g. by a community note); the rest are accepted ahead of the
 * harvest labelling real footage. Anything else is unknown.
 */
export function verdictFromLabel(label: string | null | undefined): Verdict | undefined {
  switch (label?.trim().toLowerCase()) {
    case 'confirmed':
    case 'ai':
      return 'ai';
    case 'real':
    case 'not_ai':
    case 'authentic':
      return 'real';
    default:
      return undefined;
  }
}

/** The harvest's tiers for real clips, as one line the reveal can show. */
const TIER_WHY: Record<string, string> = {
  'real-verified': 'A community note or fact-check confirms this is real footage.',
  'real-prior': 'Uploaded before 2023, before realistic AI video existed.',
  'real-agency': 'From a licensing agency that verifies footage before buying it.',
  'real-consensus': 'People who checked it on an is-this-AI forum agree it is real footage.',
};

/** One line on why a clip has its verdict, or undefined when the feed says nothing. */
export function verdictWhy(clip: Pick<Clip, 'verdict' | 'verdictTier' | 'verdictEvidence'>): string | undefined {
  if (clip.verdict === 'real' && clip.verdictTier && TIER_WHY[clip.verdictTier]) return TIER_WHY[clip.verdictTier];
  return clip.verdictEvidence || undefined;
}

/** Note text from the dumps: HTML entities decoded, whitespace collapsed. */
function cleanEvidence(text: string | null | undefined): string | undefined {
  const t = (text ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return t || undefined;
}

/** Turn an uploader name into a feed handle: "Gabriele Corno" → "gabriele_corno". */
export function toHandle(author: string | null | undefined, fallback: string): string {
  const h = (author ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\w.]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return h || fallback;
}

/**
 * yt-dlp titles X posts as "<author> - <text>"; keep the post text, minus links
 * (X rewrites them to t.co, and a link-only post becomes an empty caption).
 */
export function toCaption(title: string | null | undefined, author: string | null | undefined): string {
  let t = (title ?? '').trim();
  if (author && t.startsWith(`${author} - `)) t = t.slice(author.length + 3);
  return t
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a remote clip into the feed. `index` becomes the `clip-<index>` id the rest
 * of the app keys on, so remote and placeholder clips share one id scheme.
 */
export function toClip(r: RemoteClip, index: number): Clip {
  const likes = Math.max(0, Math.round(r.source?.likes ?? 0));
  return {
    id: `clip-${index}`,
    sourceId: r.id,
    video: { uri: r.video, useCaching: true, contentType: 'progressive' },
    poster: { uri: r.poster },
    author: toHandle(r.source?.author, r.source?.platform ?? 'unknown'),
    verified: false,
    caption: toCaption(r.source?.title, r.source?.author),
    audio: 'Original audio',
    likes,
    // The feed only knows likes; derive stable stand-ins for the other counts.
    comments: Math.round(likes * 0.012),
    shares: Math.round(likes * 0.03),
    aspect: r.width / r.height,
    tellsUrl: r.tells ?? undefined,
    tellsVariants: tellsVariants(r),
    sourceUrl: r.source?.url,
    tile: typeof r.tile === 'string' && r.tile ? r.tile : undefined,
    verdict: verdictFromLabel(r.label),
    verdictTier: typeof r.tier === 'string' && r.tier ? r.tier : undefined,
    verdictEvidence: typeof r.evidence === 'string' ? cleanEvidence(r.evidence) : undefined,
  };
}
