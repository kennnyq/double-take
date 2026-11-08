import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDemoUrl } from './demoUrl.ts';

// The stage bundle's own vectors (build/hill/stage-export-v1/bundle/url-normalization.json).
const BUNDLE_VECTORS: [string, string][] = [
  ['https://x.com/i/status/1999791899142766706', 'https://x.com/i/status/1999791899142766706'],
  ['https://www.reddit.com/r/isthisAI/comments/1sohdms/this_polar_bear_at_a_zoo_enjoying_his_ice_bath/', 'https://www.reddit.com/comments/1sohdms'],
  ['https://x.com/i/status/1944510127408926943', 'https://x.com/i/status/1944510127408926943'],
  ['https://twitter.com/example/status/1999791899142766706?s=20', 'https://x.com/i/status/1999791899142766706'],
  ['https://x.com/example/status/1944510127408926943/video/1', 'https://x.com/i/status/1944510127408926943'],
  ['https://redd.it/1sohdms', 'https://www.reddit.com/comments/1sohdms'],
];

test('prepared-source-url-v1: the bundle vectors', () => {
  for (const [input, want] of BUNDLE_VECTORS) assert.equal(normalizeDemoUrl(input), want, input);
});

test('X / Twitter variants share one key', () => {
  for (const u of [
    'http://mobile.twitter.com/someone/status/2023151052800000040/',
    'x.com/someone/status/2023151052800000040/photo/2#top',
    'https://fxtwitter.com/someone/status/2023151052800000040',
    'https://www.x.com/someone/statuses/2023151052800000040',
  ]) {
    assert.equal(normalizeDemoUrl(u), 'https://x.com/i/status/2023151052800000040', u);
  }
});

test('Reddit, TikTok and YouTube forms', () => {
  assert.equal(normalizeDemoUrl('https://old.reddit.com/r/x/comments/ABC12/title/?utm=1'), 'https://www.reddit.com/comments/abc12');
  assert.equal(normalizeDemoUrl('https://www.tiktok.com/@some.one/video/123?is_from_webapp=1'), 'https://www.tiktok.com/@some.one/video/123');
  for (const u of ['https://youtu.be/dQw4w9WgXcQ?t=3', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ&list=x']) {
    assert.equal(normalizeDemoUrl(u), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', u);
  }
});

test('other links keep host and path; not links are null', () => {
  assert.equal(normalizeDemoUrl(' https://Example.com/a/?b=1#c '), 'https://example.com/a');
  for (const u of ['', '   ', 'hello', 'ftp://x.com/a', 'javascript:alert(1)']) assert.equal(normalizeDemoUrl(u), null, u);
});
