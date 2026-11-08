/** Print a reproducible demo order without media URLs or credentials.
 * node scripts/data/demo-order.ts build/feeds/demo.json [seed]
 */
import { readFileSync } from 'node:fs';
import { toClip, type RemoteClip } from '../../src/data/remote.ts';
import { rankClips, scoreClip, tellSummary } from '../../src/data/rank.ts';
const [path, seedArg = '20261108'] = process.argv.slice(2);
if (!path) throw new Error('Usage: demo-order.ts <feed.json> [seed]');
const seed = Number(seedArg);
if (!Number.isFinite(seed)) throw new Error('Seed must be a number');
const clips = (JSON.parse(readFileSync(path, 'utf8')).clips as RemoteClip[]).map(toClip);
console.log(JSON.stringify({ seed, top10: rankClips(clips, { seed }).slice(0, 10).map((clip, i) => ({
  position: i + 1, id: clip.sourceId, verdict: clip.verdict, score: scoreClip(clip),
  seconds: clip.duration, boxedTells: tellSummary(clip)?.boxed ?? 0,
})) }, null, 2));
