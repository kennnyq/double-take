import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip } from '../data/clips.ts';
import { hasClip, initialSocialState, socialReducer, type SocialState } from './reducer.ts';
import { clipIndex, clipKey, isPersistable } from './clipRefs.ts';
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

test('remote clips are keyed by source id, so a moved clip keeps its state', () => {
  const remote = { ...clip(0), sourceId: 'x-123' } as Clip;
  let s = socialReducer(initialSocialState, { type: 'toggle', kind: 'liked', clip: remote, at: 1 });
  assert.deepEqual(
    s.liked.map((e) => e.id),
    ['x-123'],
  );
  // The same clip at another feed position is still liked, and unliking it works.
  const moved = { ...remote, id: 'clip-9' } as Clip;
  assert.equal(clipKey(moved), 'x-123');
  assert.ok(hasClip(s.liked, clipKey(moved)));
  s = socialReducer(s, { type: 'toggle', kind: 'liked', clip: moved, at: 2 });
  assert.deepEqual(s.liked, []);
  // Placeholders have no source id and fall back to the positional id.
  assert.equal(clipKey(clip(4)), 'clip-4');
  assert.equal(isPersistable(clip(4)), false);
  assert.equal(isPersistable(remote), true);
});

test('hydrate replaces the state; reset clears it; stats merge', () => {
  const loaded = { ...initialSocialState, followed: ['lumen.lab'], stats: { 'x-1': { likes: 2, reposts: 0, comments: 0 } } };
  let s = socialReducer(socialReducer(initialSocialState, { type: 'follow', author: 'other' }), { type: 'hydrate', state: loaded });
  assert.equal(s, loaded);
  s = socialReducer(s, { type: 'stats', stats: { 'x-2': { likes: 1, reposts: 1, comments: 1 } } });
  assert.deepEqual(Object.keys(s.stats).sort(), ['x-1', 'x-2']);
  assert.equal(socialReducer(s, { type: 'reset' }), initialSocialState);
});

test('a failed write rolls back with the inverse action', () => {
  const remote = { ...clip(1), sourceId: 'x-1' } as Clip;
  // Optimistic like, then the save fails: toggling back with the old value undoes it.
  let s = socialReducer(initialSocialState, { type: 'toggle', kind: 'liked', clip: remote, on: true, at: 1 });
  s = socialReducer(s, { type: 'toggle', kind: 'liked', clip: remote, on: false, at: 2 });
  assert.deepEqual(s.liked, []);
  // A failed comment is removed, along with any reply to it.
  const c = (id: string, parentId: string | null = null) => ({ id, clipId: 'x-1', text: 'hi', parentId, createdAt: 0 });
  s = socialReducer(s, { type: 'comment', comment: c('a') });
  s = socialReducer(s, { type: 'comment', comment: c('b', 'a') });
  s = socialReducer(s, { type: 'comment', comment: c('z') });
  s = socialReducer(s, { type: 'uncomment', clipId: 'x-1', id: 'a' });
  assert.deepEqual(
    s.comments['x-1'].map((x) => x.id),
    ['z'],
  );
  s = socialReducer(s, { type: 'uncomment', clipId: 'x-1', id: 'z' });
  assert.equal(s.comments['x-1'], undefined);
  assert.equal(socialReducer(s, { type: 'uncomment', clipId: 'x-1', id: 'nope' }), s);
});
