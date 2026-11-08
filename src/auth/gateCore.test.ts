import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from './gateCore.ts';

test('members act at once and sign-in stays closed', () => {
  const g = createGate();
  let n = 0;
  assert.equal(
    g.request(true, 'Sign in to like', () => n++),
    true,
  );
  assert.equal(n, 1);
  assert.deepEqual(g.getSnapshot(), { open: false, reason: null, hasPending: false });
});

test('a guest action waits for sign-in, then runs exactly once', () => {
  const g = createGate();
  let n = 0;
  let changes = 0;
  g.subscribe(() => changes++);
  assert.equal(
    g.request(false, 'Sign in to like this Take', () => n++),
    false,
  );
  assert.equal(n, 0);
  assert.deepEqual(g.getSnapshot(), { open: true, reason: 'Sign in to like this Take', hasPending: true });
  g.ready();
  assert.equal(n, 1);
  assert.equal(g.getSnapshot().open, false);
  g.ready(); // a later state load doesn't replay it
  assert.equal(n, 1);
  assert.ok(changes >= 2);
});

test('dismissing drops the pending action; a newer request replaces an older one', () => {
  const g = createGate();
  const ran: string[] = [];
  g.request(false, 'like', () => ran.push('like'));
  g.dismiss();
  g.ready();
  assert.equal(ran.length, 0);
  g.request(false, 'like', () => ran.push('like'));
  g.request(false, 'save', () => ran.push('save'));
  assert.equal(g.getSnapshot().reason, 'save');
  g.ready();
  assert.deepEqual(ran, ['save']);
});

test('a plain log-in has nothing to replay', () => {
  const g = createGate();
  g.openSignIn();
  assert.deepEqual(g.getSnapshot(), { open: true, reason: null, hasPending: false });
  g.ready();
  assert.equal(g.getSnapshot().open, false);
});
