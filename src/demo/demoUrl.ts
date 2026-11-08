/**
 * The key a prepared link check is stored under (`demo_checks.normalized_url`):
 * the hill climb's `prepared-source-url-v1`, so the app, the import script and
 * the stage bundle agree. Offline only: nothing is fetched and short links
 * aren't resolved (except redd.it, which carries the post id).
 *
 *   X / Twitter   any username, /video/N or /photo/N, query → https://x.com/i/status/<id>
 *   Reddit        any comments link, redd.it/<id>          → https://www.reddit.com/comments/<id>
 *   TikTok        a full post link                         → https://www.tiktok.com/@<handle>/video/<id>
 *   YouTube       watch, shorts, embed, youtu.be           → https://www.youtube.com/watch?v=<id>
 *   anything else https://<host><path>, no query or fragment (matches only an identical stored link)
 *
 * Pure, for `node --test`.
 */
export const DEMO_URL_VERSION = 'prepared-source-url-v1';

export function normalizeDemoUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, '');
  if (!host.includes('.')) return null;
  const path = u.pathname.replace(/\/+$/, '');

  if (['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'].includes(host)) {
    const m = /\/status(?:es)?\/(\d+)/.exec(path);
    return m ? `https://x.com/i/status/${m[1]}` : `https://x.com${path}`;
  }
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const m = /\/comments\/([a-z0-9]+)/i.exec(path);
    if (m) return `https://www.reddit.com/comments/${m[1].toLowerCase()}`;
  }
  if (host === 'redd.it') {
    const id = /^\/([a-z0-9]+)$/i.exec(path)?.[1];
    if (id) return `https://www.reddit.com/comments/${id.toLowerCase()}`;
  }
  if (host === 'tiktok.com') {
    const m = /^\/(@[\w.-]+)\/video\/(\d+)/.exec(path);
    if (m) return `https://www.tiktok.com/${m[1]}/video/${m[2]}`;
  }
  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(path)?.[1];
    if (v) return `https://www.youtube.com/watch?v=${v}`;
  }
  return `https://${host}${path}`;
}
