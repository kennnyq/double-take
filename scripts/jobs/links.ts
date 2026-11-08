/** No page resolvers: public HTTPS video only. Each redirect gets fresh DNS validation,
 * then its connection is pinned to that validated address (including TLS hostname checks). */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { get } from 'node:https';
import type { IncomingMessage } from 'node:http';
export function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false; // IPv6 intentionally unsupported until equivalent range policy exists.
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 88, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}
export function videoLink(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Choose a valid public video link.');
  let u: URL; try { u = new URL(value.trim()); } catch { throw new Error('Choose a valid public video link.'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.hash) throw new Error('Choose a public HTTPS video link without credentials.');
  if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|reddit\.com|redd\.it|x\.com|twitter\.com)$/.test(u.hostname)) throw new Error('Choose a file from your device. This social link is not supported yet; private posts cannot be opened.');
  if (isIP(u.hostname.replace(/^\[|\]$/g, '')) || !u.hostname.includes('.') || /\.(local|internal|localhost)$/.test(u.hostname)) throw new Error('Choose a public video link.');
  return u;
}
export async function retrieveVideo(value: unknown, maxBytes: number, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  const url = videoLink(value);
  signal.throwIfAborted();
  const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>((resolve, reject) => {
    const abort = () => reject(new Error('Choose a video from your device. The link timed out.'));
    signal.addEventListener('abort', abort, { once: true });
    lookup(url.hostname, { all: true, family: 4 }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Choose a public video link.');
  const pinned = addresses[0];
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(url, { signal, agent: false, family: 4, lookup: (_host, _options, cb) => cb(null, pinned.address, pinned.family), headers: { Accept: 'video/mp4, video/quicktime', 'Accept-Encoding': 'identity' } }, resolve);
    request.on('error', reject);
  });
  if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (redirects >= 3 || !response.headers.location) throw new Error('Choose a direct video link. Too many redirects.');
    return retrieveVideo(new URL(response.headers.location, url).href, maxBytes, signal, redirects + 1);
  }
  if (response.statusCode !== 200 || !/^video\/(mp4|quicktime)(;|$)/i.test(response.headers['content-type'] ?? '') || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || Number(response.headers['content-length']) > maxBytes) {
    response.destroy(); throw new Error('Choose a public MP4 or MOV under 100 MB, or select a file from your device.');
  }
  return response;
}
