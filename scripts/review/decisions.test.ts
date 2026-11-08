import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecisionLog, checkPatch, fold, parseLog, type ReviewEvent } from './decisions.ts';

const FIX = join(import.meta.dirname, 'fixtures');

test('folds the shared fixture the way review.py does', () => {
  const { events, skipped } = parseLog(readFileSync(join(FIX, 'decisions.jsonl'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(FIX, 'expected.json'), 'utf8'));
  assert.equal(skipped, expected.skipped);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(fold(events)))), expected.states);
});

test('later events win per field; other fields carry over', () => {
  const ev = (id: string, at: string, set: object): ReviewEvent => ({ v: 1, id, at, by: 'k', key: 'x-1', set });
  const s = fold([ev('a', '1', { status: 'keep', note: 'n' }), ev('b', '2', { tags: ['t'] }), ev('c', '3', { status: 'discard' })]).get('x-1');
  assert.deepEqual([s?.status, s?.note, s?.tags], ['discard', 'n', ['t']]);
});

test('a union merge folds the same in any line order', () => {
  const lines = readFileSync(join(FIX, 'decisions.jsonl'), 'utf8').split('\n');
  const a = fold(parseLog(lines.join('\n')).events);
  const b = fold(parseLog([...lines].reverse().join('\n')).events);
  assert.deepEqual(Object.fromEntries(a), Object.fromEntries(b));
});

test('undo restores the previous state, and undoing the only event clears the clip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const log = new DecisionLog(join(dir, 'review', 'decisions.jsonl'));
  const t = (s: number) => new Date(Date.UTC(2026, 10, 7, 0, 0, s));
  const keep = log.append({ key: 'x-9', by: 'k', set: { status: 'keep' } }, t(1));
  const discard = log.append({ key: 'x-9', by: 'k', set: { status: 'discard' } }, t(2));
  assert.equal(log.states().get('x-9')?.status, 'discard');
  log.append({ key: 'x-9', by: 'k', undo: discard.id }, t(3));
  assert.equal(log.states().get('x-9')?.status, 'keep');
  log.append({ key: 'x-9', by: 'k', undo: keep.id }, t(4));
  assert.equal(log.states().has('x-9'), false);
  // Append-only: four lines, nothing rewritten.
  assert.equal(readFileSync(log.path, 'utf8').trim().split('\n').length, 4);
});

test('a missing log reads as empty; junk lines are skipped, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  assert.equal(new DecisionLog(join(dir, 'nope.jsonl')).states().size, 0);
  const p = join(dir, 'd.jsonl');
  writeFileSync(p, '{"v":1,"id":"a","at":"1","by":"k","key":"x-1","set":{"status":"keep"}}\n>>>>>>> theirs\n{}\n');
  const log = new DecisionLog(p);
  assert.equal(log.read().skipped, 2);
  assert.equal(log.states().get('x-1')?.status, 'keep');
});

test('checkPatch accepts decisions, tags and notes and rejects the rest', () => {
  assert.equal(checkPatch({ status: 'needs-work' }), null);
  assert.equal(checkPatch({ status: null }), null);
  assert.equal(checkPatch({ tags: ['a'], note: '' }), null);
  assert.match(String(checkPatch({ status: 'maybe' })), /bad status/);
  assert.match(String(checkPatch({ tags: 'a' })), /tags/);
  assert.match(String(checkPatch({ other: 1 })), /unknown/);
  assert.match(String(checkPatch({})), /empty/);
});

test('MergedLog folds other checkouts read-only, counts shared events once, and writes only its own', async () => {
  const { MergedLog, vettedKeys } = await import('./decisions.ts');
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const own = join(dir, 'own.jsonl');
  const other = join(dir, 'other.jsonl');
  const vet = { v: 1, id: 'w1', at: '2026-11-08T07:00:00.000Z', by: 'worker-vetted', key: 'x-1', set: { status: 'keep', tags: ['worker-vetted'] } };
  writeFileSync(other, JSON.stringify(vet) + '\n');
  writeFileSync(own, JSON.stringify(vet) + '\n'); // the same event, already merged into this checkout
  const log = new MergedLog(own, [other, own]);
  assert.equal(log.others.length, 1);
  assert.equal(log.read().events.length, 1);
  assert.deepEqual(log.read().logs.map((l) => l.writable), [true, false]);
  log.own.append({ key: 'x-1', by: 'kenny', set: { status: 'discard', note: 'mushy' } }, new Date('2026-11-08T08:00:00.000Z'));
  assert.equal(log.states().get('x-1')?.status, 'discard', 'a later decision here overrides the worker');
  assert.equal(readFileSync(other, 'utf8').trim().split('\n').length, 1, 'the other log is never written');
  assert.deepEqual([...vettedKeys(log.read().events)], ['x-1']);
});

test('vettedKeys ignores undone vetting and other reviewers', async () => {
  const { vettedKeys } = await import('./decisions.ts');
  const ev = (id: string, key: string, by: string, extra: object = {}): ReviewEvent => ({ v: 1, id, at: id, by, key, set: { status: 'keep' }, ...extra });
  const events: ReviewEvent[] = [
    ev('1', 'a', 'worker-vetted'),
    ev('2', 'b', 'worker-vetted'),
    { v: 1, id: '3', at: '3', by: 'kenny', key: 'b', undo: '2' },
    ev('4', 'c', 'kenny'),
    ev('5', 'd', 'bot', { set: { tags: ['worker-vetted'] } }),
  ];
  assert.deepEqual([...vettedKeys(events)].sort(), ['a', 'd']);
});

test('tell marks merge per annotation, null clears, and an empty mark goes', async () => {
  const { mergeTells } = await import('./decisions.ts');
  let t = mergeTells({}, { 'main/a': { pick: true } });
  t = mergeTells(t, { 'main/a': { note: 'box is late' }, 'claude/b': { note: 'vague' } });
  assert.deepEqual(t, { 'main/a': { pick: true, note: 'box is late' }, 'claude/b': { pick: false, note: 'vague' } });
  t = mergeTells(t, { 'claude/b': { note: '' }, 'main/a': null });
  assert.deepEqual(t, {});
});

test('checkPatch accepts tell marks and rejects malformed ones', () => {
  assert.equal(checkPatch({ tells: { 'nemotron-dense/fingers-merge': { pick: true, note: 'x' } } }), null);
  assert.equal(checkPatch({ tells: { 'main/a': null } }), null);
  assert.match(String(checkPatch({ tells: {} })), /1-100/);
  assert.match(String(checkPatch({ tells: { 'no-slash': { pick: true } } })), /bad tell ref/);
  assert.match(String(checkPatch({ tells: { 'main/a': { pick: 'yes' } } })), /pick/);
  assert.match(String(checkPatch({ tells: { 'main/a': { star: true } } })), /unknown mark/);
  assert.match(String(checkPatch({ tells: [] })), /object/);
});

test('tell marks never change a clip’s decision', () => {
  const ev = (id: string, set: object): ReviewEvent => ({ v: 1, id, at: id, by: 'k', key: 'x-1', set });
  const s = fold([ev('1', { status: 'keep' }), ev('2', { tells: { 'main/a': { pick: true } } })]).get('x-1');
  assert.equal(s?.status, 'keep');
  assert.deepEqual(s?.tells, { 'main/a': { pick: true, note: '' } });
});
