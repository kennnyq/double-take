import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFocusTracker, keyOwner, type KeyTarget } from './feedKeys.ts';

function el(tagName: string, o: { role?: string; inDialog?: boolean; editable?: boolean } = {}): KeyTarget {
  return {
    tagName,
    isContentEditable: !!o.editable,
    getAttribute: (n) => (n === 'role' ? (o.role ?? null) : null),
    closest: (s) => (s === '[aria-modal="true"]' && o.inDialog ? {} : null),
  };
}

test('nothing focused, the body or the feed: Space is the feed’s', () => {
  assert.equal(keyOwner(null, false), 'feed');
  assert.equal(keyOwner(el('BODY'), false), 'feed');
  assert.equal(keyOwner(el('DIV'), true), 'feed', 'a focusable non-control, like the feed itself');
});

test('a button clicked with the mouse keeps focus but not Space (the Hold Space bug)', () => {
  assert.equal(keyOwner(el('BUTTON'), false), 'feed', 'e.g. Unmute, Like or Double take after a click');
  assert.equal(keyOwner(el('DIV', { role: 'button' }), false), 'feed', 'React Native Web pressables');
});

test('a control reached with the keyboard still gets Space', () => {
  assert.equal(keyOwner(el('BUTTON'), true), 'control');
  assert.equal(keyOwner(el('DIV', { role: 'radio' }), true), 'control');
});

test('typing and dialogs keep every key', () => {
  assert.equal(keyOwner(el('INPUT'), false), 'typing');
  assert.equal(keyOwner(el('TEXTAREA'), true), 'typing');
  assert.equal(keyOwner(el('DIV', { editable: true }), false), 'typing');
  assert.equal(keyOwner(el('BUTTON', { inDialog: true }), false), 'dialog');
});

test('the focus tracker: a click means mouse focus, Tab means keyboard focus', () => {
  const f = createFocusTracker();
  assert.equal(f.keyboardFocus, false);
  f.onKeyDown('Tab');
  assert.equal(f.keyboardFocus, true);
  f.onKeyDown(' ');
  assert.equal(f.keyboardFocus, true, 'Space itself does not change how focus arrived');
  f.onPointerDown();
  assert.equal(f.keyboardFocus, false);
});
