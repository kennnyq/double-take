import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip } from '../data/clips.ts';
import { hasClip, initialSocialState, socialReducer, type SocialState } from './reducer.ts';
import { clipIndex } from './clipRefs.ts';
import { shrinkGeometry, sheetHeight } from '../feed/shrink.ts';

const clip = (i: number, poster: unknown = { uri: `https://example.test/${i}.jpg` }) =>
  ({ id: `clip-${i}`, poster, author: 'a', likes: 100 + i }) as unknown as Clip;

test('toggles keep snapshots newest first and no-op when unchanged', () => {
  let s: SocialState = initialSocialState;
  s = socialReducer(s, { type: 'toggle', kind: 'saved', clip: clip(1), at: 1 });
  s = socialReducer(s, { type: 'toggle', kind: 'saved', clip: clip(4), at: 2 });
  assert.deepEqual(
    s.saved.map((e) => e.id),
    ['clip-4', 'clip-1'],
  );
  // The snapshot is kept as given (remote clips have non-numeric posters).
  assert.deepEqual(s.saved[0].clip.poster, { uri: 'https://example.test/4.jpg' });
  // Forcing "on" for something already on (double-tap like) returns the same state.
  assert.equal(socialReducer(s, { type: 'toggle', kind: 'saved', clip: clip(1), on: true, at: 3 }), s);
  s = socialReducer(s, { type: 'toggle', kind: 'saved', clip: clip(4), at: 4 });
  assert.ok(!hasClip(s.saved, 'clip-4'));
  assert.equal(socialReducer(s, { type: 'toggle', kind: 'saved', clip: clip(9), on: false, at: 5 }), s);
});

test('sending again moves the clip to the front', () => {
  let s = initialSocialState;
  s = socialReducer(s, { type: 'sent', clip: clip(1), at: 1 });
  s = socialReducer(s, { type: 'sent', clip: clip(2), at: 2 });
  s = socialReducer(s, { type: 'sent', clip: clip(1), at: 3 });
  assert.deepEqual(
    s.sent.map((e) => [e.id, e.at]),
    [
      ['clip-1', 3],
      ['clip-2', 2],
    ],
  );
});

test('follow toggles', () => {
  let s = socialReducer(initialSocialState, { type: 'follow', author: 'lumen.lab' });
  assert.deepEqual(s.followed, ['lumen.lab']);
  s = socialReducer(s, { type: 'follow', author: 'lumen.lab' });
  assert.deepEqual(s.followed, []);
});

test('comments and comment likes', () => {
  let s = initialSocialState;
  const c = (id: string, parentId: string | null = null) => ({ id, clipId: 'clip-3', text: 'hi', parentId, createdAt: 0 });
  s = socialReducer(s, { type: 'comment', comment: c('me-1') });
  s = socialReducer(s, { type: 'comment', comment: c('me-2', 'clip-3-c0') });
  assert.deepEqual(
    s.comments['clip-3'].map((x) => x.id),
    ['me-2', 'me-1'],
  );
  s = socialReducer(s, { type: 'likeComment', id: 'clip-3-c0' });
  assert.ok(s.likedComments['clip-3-c0']);
  s = socialReducer(s, { type: 'likeComment', id: 'clip-3-c0' });
  assert.equal(s.likedComments['clip-3-c0'], undefined);
});

test('clip index from id', () => {
  assert.equal(clipIndex('clip-0'), 0);
  assert.equal(clipIndex('clip-42'), 42);
  assert.equal(clipIndex('nonsense'), 0);
});

test('shrunk video fits between the status bar and the sheet', () => {
  const winH = 852;
  const feedH = 852 - 92;
  const top = 59;
  const { scale, dy } = shrinkGeometry(feedH, winH, top);
  const shrunkTop = feedH / 2 - (scale * feedH) / 2 + dy;
  const shrunkBottom = shrunkTop + scale * feedH;
  assert.ok(scale > 0 && scale < 1);
  assert.ok(Math.abs(shrunkTop - (top + 6)) < 0.001);
  assert.ok(shrunkBottom <= winH - sheetHeight(winH));
  assert.deepEqual(shrinkGeometry(0, winH, top), { scale: 1, dy: 0 });
});
