import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaPath, mediaType, parseBundle } from './bundle.ts';

const sha = 'a'.repeat(64);

test("the hill's stage bundle format parses; link rows are normalized and checked", () => {
  const { checks, problems } = parseBundle({
    normalizationVersion: 'prepared-source-url-v1',
    items: [
      { id: 'dog-file', kind: 'file', sha256: sha.toUpperCase(), label: 'ai', result: { verdict: {} }, mediaFile: `media/${sha}.mp4`, jobFile: 'jobs/j.json', reference: { sourceId: 'x-1' } },
      {
        id: 'dog-link-1',
        kind: 'link',
        sha256: sha,
        url: 'https://twitter.com/a/status/123?s=20',
        normalizedUrl: 'https://x.com/i/status/123',
        result: {},
        mediaFile: `media/${sha}.mp4`,
      },
    ],
  });
  assert.deepEqual(problems, []);
  assert.equal(checks[0].sha256, sha);
  assert.equal(checks[0].jobFile, 'jobs/j.json');
  assert.deepEqual(checks[0].reference, { sourceId: 'x-1' });
  assert.equal(checks[1].normalizedUrl, 'https://x.com/i/status/123');
  // Both rows share one stored video.
  assert.equal(mediaPath(checks[0].media!, sha), `${sha}.mp4`);
  assert.equal(mediaPath(checks[1].media!, sha), `${sha}.mp4`);
});

test('a bare array and the older field names work; a file row may hash its media', () => {
  const { checks, problems } = parseBundle([{ id: 'f', kind: 'file', media: 'f.mov', resultFile: 'f.json' }]);
  assert.deepEqual(problems, []);
  assert.equal(checks[0].sha256, null);
  assert.equal(checks[0].media, 'f.mov');
});

test('problems are listed, not thrown', () => {
  const { checks, problems } = parseBundle({
    normalizationVersion: 'v0',
    items: [
      { id: 'bad id!', kind: 'file' },
      { id: 'a', kind: 'video' },
      { id: 'b', kind: 'file', result: {} },
      { id: 'c', kind: 'link', url: 'nope', result: {} },
      { id: 'c2', kind: 'link', url: 'https://x.com/a/status/1', normalizedUrl: 'https://x.com/a/status/1', result: {} },
      { id: 'd', kind: 'file', sha256: sha, mediaFile: '../escape.mp4', result: {} },
      { id: 'e', kind: 'file', sha256: sha },
      { id: 'f', kind: 'file', sha256: sha, result: {}, resultFile: 'f.json' },
      { id: 'g', kind: 'file', sha256: sha, result: {} },
      { id: 'g', kind: 'file', sha256: sha, result: {} },
      { id: 'h', kind: 'file', sha256: sha, media: 'h.exe', result: {} },
      { id: 'i', kind: 'file', sha256: sha, result: {}, jobFile: '/etc/passwd' },
    ],
  });
  assert.deepEqual(
    checks.map((c) => c.id),
    ['g'],
  );
  assert.equal(problems.length, 12, problems.join('\n'));
  assert.match(problems[0], /normalizationVersion/);
  assert.deepEqual(parseBundle({}).problems, ['index.json needs an "items" array']);
});

test('media types', () => {
  assert.equal(mediaType('x.MP4'), 'video/mp4');
  assert.equal(mediaType('x.mov'), 'video/quicktime');
  assert.equal(mediaType('x.gif'), null);
});
