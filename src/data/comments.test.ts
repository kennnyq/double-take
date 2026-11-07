import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, makeComments, makeReplies } from './comments.ts';

const clip = { id: 'clip-7', author: 'lumen.lab', likes: 250_000 };

test('comments are deterministic per clip and differ between clips', () => {
  assert.deepEqual(makeComments(clip), makeComments({ ...clip }));
  const other = makeComments({ ...clip, id: 'clip-8' });
  assert.notDeepEqual(
    makeComments(clip).map((c) => c.text),
    other.map((c) => c.text),
  );
});

test('comment shape: count, ids, ranges, author badge', () => {
  for (let i = 0; i < 60; i++) {
    const seed = { id: `clip-${i}`, author: 'pixel_garden', likes: 1000 + i * 9000 };
    const list = makeComments(seed);
    assert.ok(list.length >= 12 && list.length <= 20, `count ${list.length}`);
    assert.equal(new Set(list.map((c) => c.id)).size, list.length);
    for (const [k, c] of list.entries()) {
      assert.ok(c.replyCount >= 0 && c.replyCount <= 40);
      assert.ok(c.likes >= 0);
      assert.equal(c.parentId, null);
      assert.equal(c.isAuthor, c.handle === seed.author);
      if (c.isAuthor) assert.equal(k, 0, 'only the first comment can be by the author');
    }
    assert.ok(list[0].likes >= list[list.length - 1].likes, 'likes descend overall');
  }
});

test('replies: up to 3, deterministic, linked to their parent', () => {
  const list = makeComments(clip);
  for (const parent of list) {
    const replies = makeReplies(parent, clip.author);
    assert.equal(replies.length, Math.min(3, parent.replyCount));
    assert.deepEqual(replies, makeReplies(parent, clip.author));
    for (const r of replies) {
      assert.equal(r.parentId, parent.id);
      assert.equal(r.clipId, clip.id);
      assert.ok(r.ago <= parent.ago, 'reply is newer than its parent');
      assert.notEqual(r.handle, parent.handle);
    }
    assert.equal(new Set(replies.map((r) => r.id)).size, replies.length);
  }
  assert.equal(makeReplies({ ...list[0], replyCount: 0 }, clip.author).length, 0);
});

test('relative time formatting', () => {
  assert.equal(formatAgo(0), 'now');
  assert.equal(formatAgo(5), '5m');
  assert.equal(formatAgo(17 * 60 + 5), '17h');
  assert.equal(formatAgo(2 * 24 * 60), '2d');
  assert.equal(formatAgo(5 * 7 * 24 * 60 + 30), '5w');
});
