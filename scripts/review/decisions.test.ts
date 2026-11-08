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
