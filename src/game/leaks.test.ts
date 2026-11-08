import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaks, safeCaption, safeClip, safeHandle } from './leaks.ts';
import type { Clip } from '../data/clips.ts';

test('words that give the answer away', () => {
  for (const t of ['This is AI', 'made with Sora', '#aiart', 'A.I. generated', 'totally real footage', 'Deepfake alert', 'is this AI?', 'Veo 3 test', 'CGI', 'r_isthisai']) {
    assert.ok(leaks(t), t);
  }
  for (const t of ['Tiger shark trying to get the hook out', 'my cat dragged a stray kitten home', 'Unreal sunset', 'airport', 'said', 'realistic? no', 'Kenny']) {
    assert.ok(!leaks(t), t);
  }
});

test('captions keep their safe parts', () => {
  assert.equal(safeCaption('Took me three tries to get this shot. Made with Sora! #loop'), 'Took me three tries to get this shot. #loop');
  assert.equal(safeCaption('Real or AI? You decide #doubletake #ai'), 'You decide #doubletake');
  assert.equal(safeCaption('#aiart #sora'), '');
  assert.equal(safeCaption('Tiger Shark trying to get the hook out… #shark'), 'Tiger Shark trying to get the hook out… #shark');
});

test('handles that leak become stable stand-ins', () => {
  assert.equal(safeHandle('spaceshark'), 'spaceshark');
  const h = safeHandle('ai_creations');
  assert.match(h, /^creator_\d{4}$/);
  assert.equal(safeHandle('ai_creations'), h);
});

test('a game clip carries no verdict, tells or source', () => {
  const clip = {
    id: 'clip-1',
    video: 1,
    poster: 2,
    author: 'sora_daily',
    verified: false,
    caption: 'Not real! #ai',
    audio: 'Original audio',
    likes: 1,
    comments: 0,
    shares: 0,
    verdict: 'ai',
    verdictTier: 'x',
    verdictEvidence: 'note',
    tellsUrl: 'u',
    tellsVariants: [{ name: 'main', url: 'u' }],
    sourceUrl: 's',
  } as unknown as Clip;
  const s = safeClip(clip);
  for (const k of ['verdict', 'verdictTier', 'verdictEvidence', 'tellsUrl', 'tellsVariants', 'sourceUrl'] as const) assert.equal(s[k], undefined, k);
  assert.equal(s.caption, '');
  // A forum post's title argues about it: dropped with the handle.
  assert.equal(safeClip({ ...clip, author: 'r_isthisai', caption: 'Wet footprints seem to make no sense' }).caption, '');
  assert.equal(safeClip({ ...clip, author: 'spaceshark', caption: 'Tiger shark #shark' }).caption, 'Tiger shark #shark');
  assert.notEqual(s.author, 'sora_daily');
  assert.equal(s.id, clip.id);
});
