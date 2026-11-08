import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, clipId, kindOf, rehost, snowflakeTime } from './catalog.ts';

test('clipId keys clips like build_media.py', () => {
  assert.equal(clipId('https://x.com/i/status/2023151052800000040'), 'x-2023151052800000040');
  assert.equal(clipId('https://twitter.com/someone/status/123?s=20'), 'x-123');
  assert.equal(clipId('https://www.youtube.com/watch?v=qt5p-_tE8d0'), 'yt-qt5p-_tE8d0');
  assert.equal(clipId('https://youtube.com/shorts/abcdefghijk'), 'yt-abcdefghijk');
  assert.equal(clipId('https://youtu.be/abcdefghijk'), 'yt-abcdefghijk');
  // Python: "u-" + hashlib.sha256(url.encode()).hexdigest()[:16]
  assert.equal(clipId('https://www.youtube.com/live/qt5p-_tE8d0'), 'u-77eaae1a026057b6');
  assert.equal(clipId('https://www.reddit.com/r/isthisAI/comments/1abc2d/goat_on_a_cliff/'), 'rd-1abc2d');
});

test('snowflakeTime dates X posts', () => {
  assert.equal(new Date(snowflakeTime('x-2023151052800000040')!).toISOString().slice(0, 10), '2026-02-15');
  assert.equal(snowflakeTime('yt-abcdefghijk'), undefined);
});

test('kindOf reads labels and tiers', () => {
  assert.equal(kindOf('confirmed', undefined), 'ai');
  assert.equal(kindOf('real', 'real-prior'), 'real');
  assert.equal(kindOf(undefined, 'real-agency'), 'real');
  assert.equal(kindOf('not-ai-cgi', 'not-ai-cgi'), 'cgi');
  assert.equal(kindOf('likely_partial', undefined), 'unknown');
  assert.equal(kindOf('real', 'real-consensus'), 'real');
});

test('Reddit batch rows carry their thread and consensus, and date from the thread', () => {
  const cat = new Catalog();
  const consensus = {
    verdict: 'real',
    confidence: 0.9,
    ai: 1,
    real: 19,
    voters: 6,
    flair: 'Not AI',
    evidence: [{ stance: 'real', score: 400, text: 'Posted in 2018' }],
    tells: [],
  };
  const url = 'https://www.reddit.com/r/isthisAI/comments/1abc2d/goat/';
  cat.addBatch('reddit-2026-11-07', [
    { url, label: 'real', tier: 'real-consensus', evidence: 'r/isthisAI consensus: real', consensus, thread: { sub: 'isthisAI', url, created: 1767225600 } },
  ]);
  const [it] = cat.list();
  assert.equal(it.key, 'rd-1abc2d');
  assert.equal(it.kind, 'real');
  assert.equal(it.consensus?.voters, 6);
  assert.equal(it.thread?.sub, 'isthisAI');
  assert.equal(new Date(it.date!).toISOString().slice(0, 10), '2026-01-01');
});

const clip = (id: string, extra: object = {}) => ({
  id,
  video: `https://w/m/${id}.mp4`,
  poster: `https://w/m/${id}.jpg`,
  tells: null,
  width: 720,
  height: 1280,
  duration: 10,
  ...extra,
});

test('merges feeds from several sources and batches into one item per clip key', () => {
  const cat = new Catalog();
  cat.addFeed('prod', 'demo', [clip('x-1', { label: 'confirmed', evidence: 'AI note' })]);
  cat.addFeed('local', 'demo', [
    { ...clip('x-1', { label: 'confirmed' }), video: 'http://localhost:8787/x-1.mp4' },
    clip('yt-abcdefghijk', { label: 'real', tier: 'real-prior', pairOf: 'x-1', how: 'search' }),
  ]);
  cat.addFeed('local', 'compare', [clip('x-1'), clip('yt-abcdefghijk', { pairOf: 'x-1' })]);
  cat.addBatch('real-2026-11-07', [
    { url: 'https://x.com/i/status/1', label: 'confirmed' },
    { url: 'https://www.youtube.com/watch?v=abcdefghijk', label: 'real', tier: 'real-prior', pairOf: 'x-1' },
    { url: 'https://x.com/i/status/2', label: 'confirmed', evidence: 'not built yet' },
  ]);
  cat.addNotes([{ tweetId: '1', url: 'https://x.com/i/birdwatch/n/9', text: 'note', status: 'CURRENTLY_RATED_HELPFUL' }]);
  const items = new Map(cat.list().map((i) => [i.key, i]));
  assert.deepEqual([...items.keys()].sort(), ['x-1', 'x-2', 'yt-abcdefghijk']);

  const ai = items.get('x-1')!;
  assert.equal(ai.media?.video, 'https://w/m/x-1.mp4', 'media comes from the first source (prod)');
  assert.deepEqual(
    ai.in.map((m) => `${m.kind}:${m.source ?? ''}/${m.name}`),
    ['feed:prod/demo', 'feed:local/demo', 'feed:local/compare', 'batch:/real-2026-11-07'],
  );
  assert.deepEqual(ai.partners, ['yt-abcdefghijk']);
  assert.equal(ai.note?.url, 'https://x.com/i/birdwatch/n/9');
  assert.equal(ai.kind, 'ai');

  const real = items.get('yt-abcdefghijk')!;
  assert.deepEqual([real.kind, real.tier, real.pairOf, real.how], ['real', 'real-prior', 'x-1', 'search']);

  const unbuilt = items.get('x-2')!;
  assert.equal(unbuilt.media, undefined);
  assert.equal(unbuilt.evidence, 'not built yet');
});

test('rehost points a local Worker at the browser host and leaves others alone', () => {
  const [c] = rehost(
    [{ video: 'http://localhost:8787/m/a?sig=1', poster: 'https://prod.example/m/p', tells: null, tellsAlt: { claude: 'http://127.0.0.1:8787/m/t' } }],
    'kenny-wsl.tail575a57.ts.net',
  );
  assert.equal(c.video, 'http://kenny-wsl.tail575a57.ts.net:8787/m/a?sig=1');
  assert.equal(c.poster, 'https://prod.example/m/p');
  assert.equal(c.tells, null);
  assert.deepEqual(c.tellsAlt, { claude: 'http://kenny-wsl.tail575a57.ts.net:8787/m/t' });
});
