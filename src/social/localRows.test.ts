import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip } from '../data/clips.ts';
import { EMPTY_ROWS, parseLocalRows, toLocalRows } from './localRows.ts';
import { initialSocialState, socialReducer, type SocialState } from './reducer.ts';
import { clipsByKey, toSocialState } from './sync.ts';

const remote = (i: number) => ({ id: `clip-${i}`, sourceId: `x-${i}`, author: 'a', likes: 10 }) as unknown as Clip;
const placeholder = (i: number) => ({ id: `clip-${i}`, author: 'b', likes: 5 }) as unknown as Clip;

test("a guest's state survives storing and loading, rebuilt from the live feed", () => {
  let s: SocialState = initialSocialState;
  s = socialReducer(s, { type: 'toggle', kind: 'liked', clip: remote(1), at: 1000 });
  s = socialReducer(s, { type: 'toggle', kind: 'liked', clip: placeholder(20), at: 2000 });
  s = socialReducer(s, { type: 'toggle', kind: 'reposted', clip: remote(2), at: 3000 });
  s = socialReducer(s, { type: 'toggle', kind: 'saved', clip: remote(2), at: 3500 });
  s = socialReducer(s, { type: 'sent', clip: remote(1), at: 4000 });
  s = socialReducer(s, { type: 'follow', author: 'lumen.lab' });
  s = socialReducer(s, { type: 'follow', author: 'half.tone' });
  s = socialReducer(s, { type: 'comment', comment: { id: 'g1', clipId: 'x-1', text: 'hi', parentId: null, createdAt: 5000 } });
  s = socialReducer(s, { type: 'comment', comment: { id: 'g2', clipId: 'x-1', text: 'reply', parentId: 'x-1-c0', createdAt: 6000 } });
  s = socialReducer(s, { type: 'likeComment', id: 'x-1-c0' });

  const stored = JSON.stringify(toLocalRows(s));
  // The feed reloads: same clips at new positions, fresh objects.
  const feed = [{ ...remote(2), id: 'clip-0' }, { ...remote(1), id: 'clip-1' }, placeholder(20)] as Clip[];
  const back = toSocialState(parseLocalRows(stored), clipsByKey(feed));

  const ids = (l: SocialState['liked']) => l.map((e) => e.id);
  assert.deepEqual(ids(back.liked), ['clip-20', 'x-1']);
  assert.deepEqual(ids(back.reposted), ['x-2']);
  assert.deepEqual(ids(back.saved), ['x-2']);
  assert.deepEqual(ids(back.sent), ['x-1']);
  assert.equal(back.liked[1].clip.id, 'clip-1', 'tiles come from the live feed');
  assert.deepEqual(back.followed, ['half.tone', 'lumen.lab']);
  assert.deepEqual(
    back.comments['x-1'].map((c) => [c.id, c.parentId, c.text]),
    [
      ['g2', 'x-1-c0', 'reply'],
      ['g1', null, 'hi'],
    ],
  );
  assert.deepEqual(back.likedComments, { 'x-1-c0': true });
});

test('missing or broken storage loads as empty', () => {
  assert.deepEqual(parseLocalRows(null), EMPTY_ROWS);
  assert.deepEqual(parseLocalRows('{oops'), EMPTY_ROWS);
  assert.deepEqual(parseLocalRows('[1,2]'), EMPTY_ROWS);
  const partial = parseLocalRows(JSON.stringify({ likes: [{ clip_key: 'x-1', created_at: 'T' }, { nope: 1 }, 5], comments: [{ id: 'c' }] }));
  assert.deepEqual(partial.likes, [{ clip_key: 'x-1', created_at: 'T' }]);
  assert.deepEqual(partial.comments, []);
});
