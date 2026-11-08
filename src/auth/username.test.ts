import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authErrorMessage,
  normalizeUsername,
  passwordProblem,
  usernameEmail,
  usernameFromEmail,
  usernameProblem,
} from './username.ts';

test('usernames are trimmed, lower-cased, and lose a leading @', () => {
  assert.equal(normalizeUsername('  @Kenny.Q '), 'kenny.q');
});

test('usernames match the handle rule', () => {
  for (const ok of ['kenny', 'k_q', 'a.b.c', '___', 'x'.repeat(24), 'lumen.lab', '123']) {
    assert.equal(usernameProblem(ok), null, ok);
  }
  assert.match(usernameProblem('ab')!, /At least 3/);
  assert.match(usernameProblem('x'.repeat(25))!, /At most 24/);
  assert.match(usernameProblem('ken ny')!, /only letters/);
  assert.match(usernameProblem('kenny!')!, /only letters/);
  assert.match(usernameProblem('Kenny')!, /only letters/); // callers normalize first
  assert.match(usernameProblem('.kenny')!, /start or end/);
  assert.match(usernameProblem('kenny.')!, /start or end/);
  assert.match(usernameProblem('ken..ny')!, /two dots/);
});

test('a username maps to an undeliverable address and back', () => {
  assert.equal(usernameEmail('kenny'), 'kenny@users.double-take.invalid');
  assert.equal(usernameFromEmail('kenny@users.double-take.invalid'), 'kenny');
  assert.equal(usernameFromEmail('dt-test+alice@example.com'), null);
  assert.equal(usernameFromEmail(null), null);
});

test('passwords need 8+ characters with letters and numbers', () => {
  assert.match(passwordProblem('Ab1')!, /At least 8/);
  assert.match(passwordProblem('abcdefgh')!, /letters and numbers/);
  assert.match(passwordProblem('12345678')!, /letters and numbers/);
  assert.equal(passwordProblem('hunter22x'), null);
});

test('auth errors read well and do not say which part was wrong', () => {
  assert.equal(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'signIn'), 'Wrong username or password.');
  assert.equal(authErrorMessage({ code: 'user_already_exists' }, 'signUp'), 'That username is taken.');
  assert.equal(authErrorMessage({ message: 'Database error saving new user' }, 'signUp'), 'That username is taken.');
  assert.match(authErrorMessage({ status: 429 }, 'signIn'), /Too many/);
  assert.match(authErrorMessage({ code: 'weak_password', message: 'x' }, 'signUp'), /too weak/);
});
