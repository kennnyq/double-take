import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_MAX, normalizeNote } from './noteText.ts';

test('notes are tidied, capped and cleared when empty', () => {
  assert.equal(normalizeNote('  hello   there \n'), 'hello there');
  assert.equal(normalizeNote(''), null);
  assert.equal(normalizeNote('   '), null);
  assert.equal(normalizeNote(null), null);
  assert.equal(Array.from(normalizeNote('x'.repeat(80))!).length, NOTE_MAX);
});

test('the cap counts characters, so emoji stay whole', () => {
  const n = normalizeNote('😀'.repeat(70))!;
  assert.equal(Array.from(n).length, NOTE_MAX);
  assert.ok(n.endsWith('😀'));
});
