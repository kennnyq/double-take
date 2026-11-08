import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip } from '../data/clips.ts';
import {
  clipsByKey,
  createWriteQueue,
  othersCounts,
  planWrite,
  toSocialState,
  type MineRows,
  type SocialWrite,
} from './sync.ts';

const U = '00000000-0000-4000-8000-000000000001';
const remote = (i: number) => ({ id: `clip-${i}`, sourceId: `x-${i}`, author: 'a', likes: 10 }) as unknown as Clip;

test('toggles map to upserts and deletes on the right table', () => {
  assert.deepEqual(planWrite({ kind: 'list', list: 'liked', key: 'x-1', on: true }, U), {
    op: 'upsert',
    table: 'likes',
    values: { user_id: U, clip_key: 'x-1' },
    onConflict: 'user_id,clip_key',
    ignoreDuplicates: true,
  });
  assert.deepEqual(planWrite({ kind: 'list', list: 'saved', key: 'x-1', on: false }, U), {
    op: 'delete',
    table: 'saves',
    match: { user_id: U, clip_key: 'x-1' },
  });
  assert.equal(planWrite({ kind: 'list', list: 'reposted', key: 'x-1', on: true }, U).table, 'reposts');
  assert.deepEqual(planWrite({ kind: 'follow', author: 'lumen.lab', on: false }, U), {
    op: 'delete',
    table: 'follows',
    match: { user_id: U, author_handle: 'lumen.lab' },
  });
  assert.equal(planWrite({ kind: 'likeComment', ref: 'x-1-c0', on: true }, U).table, 'comment_likes');
});

test('sends upsert and bump their time; recipients are clamped', () => {
  const p = planWrite({ kind: 'sent', key: 'x-1', recipients: 99, at: 0 }, U);
  assert.equal(p.op, 'upsert');
  if (p.op !== 'upsert') return;
  assert.equal(p.ignoreDuplicates, false);
  assert.equal(p.values.recipients, 50);
  assert.equal(p.values.created_at, '1970-01-01T00:00:00.000Z');
});

test('replies point at a real comment or a stand-in', () => {
  const base = { id: '11111111-1111-4111-8111-111111111111', clipId: 'x-1', text: 'hi', createdAt: 0 };
  const real = planWrite({ kind: 'comment', comment: { ...base, parentId: '22222222-2222-4222-8222-222222222222' } }, U);
  const standIn = planWrite({ kind: 'comment', comment: { ...base, parentId: 'x-1-c3' } }, U);
  const top = planWrite({ kind: 'comment', comment: { ...base, parentId: null } }, U);
  assert.ok(real.op === 'insert' && standIn.op === 'insert' && top.op === 'insert');
  if (real.op !== 'insert' || standIn.op !== 'insert' || top.op !== 'insert') return;
  assert.equal(real.values.parent_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(real.values.stand_in_parent, null);
  assert.equal(standIn.values.parent_id, null);
  assert.equal(standIn.values.stand_in_parent, 'x-1-c3');
  assert.equal(top.values.parent_id, null);
  assert.equal(top.values.stand_in_parent, null);
});

const mine: MineRows = {
  likes: [
    { clip_key: 'x-1', created_at: '2026-11-07T10:00:00Z' },
    { clip_key: 'x-2', created_at: '2026-11-07T12:00:00Z' },
    { clip_key: 'x-gone', created_at: '2026-11-07T13:00:00Z' },
  ],
  saves: [{ clip_key: 'x-2', created_at: '2026-11-07T12:00:00Z' }],
  reposts: [],
  sends: [],
  follows: [{ author_handle: 'lumen.lab', created_at: '2026-11-07T12:00:00Z' }],
  comments: [
    { id: 'c1', clip_key: 'x-1', parent_id: null, stand_in_parent: null, body: 'first', created_at: '2026-11-07T10:00:00Z' },
    { id: 'c2', clip_key: 'x-1', parent_id: null, stand_in_parent: 'x-1-c0', body: 'reply', created_at: '2026-11-07T11:00:00Z' },
  ],
  commentLikes: [{ comment_ref: 'x-1-c0' }],
};

test('saved rows become social state, rebuilt from the live clips', () => {
  const s = toSocialState(mine, clipsByKey([remote(1), remote(2)]), [{ clip_key: 'x-1', likes: 3, reposts: 0, comments: 2 }]);
  // Newest first; a clip that's no longer in the feed is left off.
  assert.deepEqual(
    s.liked.map((e) => [e.id, e.clip.id]),
    [
      ['x-2', 'clip-2'],
      ['x-1', 'clip-1'],
    ],
  );
  assert.deepEqual(
    s.saved.map((e) => e.id),
    ['x-2'],
  );
  assert.deepEqual(s.followed, ['lumen.lab']);
  assert.deepEqual(
    s.comments['x-1'].map((c) => [c.id, c.parentId]),
    [
      ['c2', 'x-1-c0'],
      ['c1', null],
    ],
  );
  assert.deepEqual(s.likedComments, { 'x-1-c0': true });
  // Public counts minus your own share.
  assert.deepEqual(s.stats['x-1'], { likes: 2, reposts: 0, comments: 0 });
});

test("guests see everyone's counts", () => {
  assert.deepEqual(othersCounts([{ clip_key: 'x-1', likes: 3, reposts: 1, comments: 2 }]), {
    'x-1': { likes: 3, reposts: 1, comments: 2 },
  });
});

test('the write queue sends only the newest state per slot and rolls back failures', async () => {
  const sent: SocialWrite[] = [];
  const failed: SocialWrite[] = [];
  let release!: () => void;
  let fail = false;
  const q = createWriteQueue(
    async (w) => {
      sent.push(w);
      if (sent.length === 1) await new Promise<void>((r) => (release = r));
      if (fail) throw new Error('offline');
    },
    (w) => failed.push(w),
  );
  const like = (on: boolean): SocialWrite => ({ kind: 'list', list: 'liked', key: 'x-1', on });
  const first = q.push(like(true));
  // Three more toggles while the first is in flight: only the last is sent.
  q.push(like(false));
  q.push(like(true));
  q.push(like(false));
  release();
  await first;
  assert.deepEqual(
    sent.map((w) => w.kind === 'list' && w.on),
    [true, false],
  );
  fail = true;
  await q.push(like(true));
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0], like(true));
});
