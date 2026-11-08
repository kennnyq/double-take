import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMember, isTestEmail } from './member.ts';

test('isMember: a signed-in, non-anonymous user', () => {
  assert.equal(isMember(null), false);
  assert.equal(isMember(undefined), false);
  assert.equal(isMember({ user: null }), false);
  assert.equal(isMember({ user: { id: '' } }), false);
  assert.equal(isMember({ user: { id: 'u1', is_anonymous: true } }), false);
  assert.equal(isMember({ user: { id: 'u1', is_anonymous: false } }), true);
  assert.equal(isMember({ user: { id: 'u1' } }), true);
});

test('isTestEmail only matches dt-test+<name>@example.com', () => {
  assert.equal(isTestEmail('dt-test+alice@example.com'), true);
  assert.equal(isTestEmail('dt-test+a1b2-c3@example.com'), true);
  assert.equal(isTestEmail('alice@example.com'), false);
  assert.equal(isTestEmail('dt-test+alice@example.com.evil.io'), false);
  assert.equal(isTestEmail('dt-test+Alice@example.com'), false);
  assert.equal(isTestEmail(null), false);
});
