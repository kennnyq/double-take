import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FeedError,
  fetchRemoteClips,
  toCaption,
  toClip,
  toHandle,
  verdictFromLabel,
  verdictWhy,
  type RemoteClip,
} from './remote.ts';

const CLIP: RemoteClip = {
  id: 'x-2023151052800000040',
  video: 'https://api.test/m/media/x/v1/720.mp4?exp=1&sig=a',
  poster: 'https://api.test/m/media/x/v1/poster.jpg?exp=1&sig=b',
  tells: 'https://api.test/m/media/x/v1/tells.json?exp=1&sig=c',
  tile: 'https://api.test/m/media/x/v1/tile.mp4?exp=1&sig=d',
  width: 1280,
  height: 720,
  duration: 10.19,
  label: 'confirmed',
  source: { url: 'https://x.com/i/status/1', platform: 'x', author: 'Stella', title: 'Stella - Yor vs the champ', likes: 3321 },
};

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test('toClip maps a remote clip onto the feed shape', () => {
  const c = toClip(CLIP, 3);
  assert.equal(c.id, 'clip-3');
  assert.equal(c.sourceId, 'x-2023151052800000040');
  assert.deepEqual(c.video, { uri: CLIP.video, useCaching: true, contentType: 'progressive' });
  assert.deepEqual(c.poster, { uri: CLIP.poster });
  assert.equal(c.author, 'stella');
  assert.equal(c.caption, 'Yor vs the champ');
  assert.equal(c.likes, 3321);
  assert.ok(Math.abs(c.aspect! - 16 / 9) < 1e-9);
  assert.equal(c.tellsUrl, CLIP.tells);
  assert.equal(c.sourceUrl, 'https://x.com/i/status/1');
  assert.equal(c.tile, CLIP.tile);
});

test('toClip keeps the ground truth only as a verdict, never the raw label', () => {
  const c = toClip(CLIP, 0);
  assert.equal(c.verdict, 'ai');
  assert.ok(!JSON.stringify(c).includes('confirmed'));
  assert.equal(toClip({ ...CLIP, label: null }, 0).verdict, undefined);
});

test('verdictFromLabel', () => {
  assert.equal(verdictFromLabel('confirmed'), 'ai');
  assert.equal(verdictFromLabel(' AI '), 'ai');
  assert.equal(verdictFromLabel('real'), 'real');
  assert.equal(verdictFromLabel('not_ai'), 'real');
  assert.equal(verdictFromLabel('disputed'), undefined);
  assert.equal(verdictFromLabel(undefined), undefined);
});

test('toClip carries why a real clip is real', () => {
  const c = toClip({ ...CLIP, label: 'real', tier: 'real-prior', evidence: 'Uploaded 2016-09-10 by  National Geographic &amp; co.' }, 0);
  assert.equal(c.verdict, 'real');
  assert.equal(c.verdictTier, 'real-prior');
  assert.equal(c.verdictEvidence, 'Uploaded 2016-09-10 by National Geographic & co.');
  assert.equal(verdictWhy(c), 'Uploaded before 2023, before realistic AI video existed.');
  // A note-verified clip still explains itself; unknown tiers fall back to the evidence.
  assert.match(verdictWhy({ ...c, verdictTier: 'real-verified' })!, /community note/);
  assert.equal(verdictWhy({ ...c, verdictTier: 'something-new' }), c.verdictEvidence);
  assert.match(verdictWhy({ ...c, verdictTier: 'real-consensus' })!, /is-this-AI forum/);
  // Reddit consensus labels map like any other: confirmed → AI, real → real.
  const fromReddit = toClip({ ...CLIP, label: 'real', tier: 'real-consensus', evidence: 'r/isthisAI consensus: real (0.92, 7 votes)' }, 0);
  assert.equal(fromReddit.verdict, 'real');
  // AI clips explain themselves with their note; clips without evidence say nothing.
  assert.equal(verdictWhy({ verdict: 'ai', verdictEvidence: 'Extra arm at 0:03.' }), 'Extra arm at 0:03.');
  const bare = toClip(CLIP, 0);
  assert.equal(bare.verdictTier, undefined);
  assert.equal(verdictWhy({ verdict: 'real' }), undefined);
});

test('toClip copes with missing source metadata', () => {
  const c = toClip({ ...CLIP, tells: null, source: undefined }, 0);
  assert.equal(c.author, 'unknown');
  assert.equal(c.caption, '');
  assert.equal(c.likes, 0);
  assert.equal(c.tellsUrl, undefined);
  assert.equal(c.tellsVariants, undefined);
  assert.equal(toClip({ ...CLIP, tile: undefined }, 0).tile, undefined);
});

test('toClip lists tells variants, main first, skipping junk', () => {
  const alt = { claude: 'https://api.test/m/media/x/v1/tells.b.json?exp=1&sig=d', main: 'https://evil', empty: '' };
  const c = toClip({ ...CLIP, tellsAlt: alt as Record<string, string> }, 0);
  assert.deepEqual(c.tellsVariants, [
    { name: 'main', url: CLIP.tells },
    { name: 'claude', url: alt.claude },
  ]);
  assert.deepEqual(toClip(CLIP, 0).tellsVariants, [{ name: 'main', url: CLIP.tells }]);
});

test('toHandle', () => {
  assert.equal(toHandle('Gabriele Corno', 'x'), 'gabriele_corno');
  assert.equal(toHandle('RyanPatrick🇺🇸🦅', 'x'), 'ryanpatrick');
  assert.equal(toHandle('ضاحي', 'x'), 'x');
  assert.equal(toHandle(null, 'yt'), 'yt');
  assert.equal(toHandle('a'.repeat(40), 'x').length, 24);
});

test('toCaption strips the "author - " prefix only', () => {
  assert.equal(toCaption('Kinsley - Boat   capsizes', 'Kinsley'), 'Boat capsizes');
  assert.equal(toCaption('Drama Queen Cat vs Nail Clippers', 'someone'), 'Drama Queen Cat vs Nail Clippers');
  assert.equal(toCaption(undefined, 'a'), '');
});

test('toCaption drops links, including link-only posts', () => {
  assert.equal(toCaption('Stella - https://t.co/oJeaozujki', 'Stella'), '');
  assert.equal(toCaption('Look at this https://t.co/abc123 wow', null), 'Look at this wow');
});

test('fetchRemoteClips sends the passcode and keeps only valid clips', async () => {
  let seen: { url: string; auth: string | null } | null = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen = { url, auth: new Headers(init?.headers).get('authorization') };
    return new Response(JSON.stringify({ clips: [CLIP, { id: 'broken' }, null] }));
  }) as typeof fetch;
  const clips = await fetchRemoteClips('https://api.test/', 'pass', { fetchImpl });
  assert.deepEqual(seen, { url: 'https://api.test/feed', auth: 'Bearer pass' });
  assert.equal(clips.length, 1);
});

test('fetchRemoteClips reports HTTP errors and malformed feeds', async () => {
  await assert.rejects(fetchRemoteClips('https://api.test', 'bad', { fetchImpl: respond(401, { error: 'bad passcode' }) }), (e) => {
    assert.ok(e instanceof FeedError);
    assert.equal(e.status, 401);
    return true;
  });
  await assert.rejects(fetchRemoteClips('https://api.test', 'p', { fetchImpl: respond(200, { nope: 1 }) }), FeedError);
});

test('fetchRemoteClips times out instead of hanging the feed', async () => {
  const hang = ((_: string, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  await assert.rejects(fetchRemoteClips('https://api.test', 'p', { fetchImpl: hang, timeoutMs: 30 }), /timed out/);
});
