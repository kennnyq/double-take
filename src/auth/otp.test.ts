import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEmail, parseOtpInput } from './otp.ts';

test('a 6-digit code, spaces allowed', () => {
  assert.deepEqual(parseOtpInput('123456'), { kind: 'code', token: '123456' });
  assert.deepEqual(parseOtpInput(' 123 456 '), { kind: 'code', token: '123456' });
  assert.equal(parseOtpInput('12345'), null);
  assert.equal(parseOtpInput('1234567'), null);
  assert.equal(parseOtpInput('abcdef'), null);
});

test("the email's sign-in link, pasted whole", () => {
  const link = 'https://ref.supabase.co/auth/v1/verify?token=pkce_0123456789abcdef&type=magiclink&redirect_to=http://localhost:3000';
  assert.deepEqual(parseOtpInput(link), { kind: 'link', tokenHash: 'pkce_0123456789abcdef', type: 'magiclink' });
  assert.equal(parseOtpInput(link.replace('magiclink', 'signup'))?.kind, 'link');
  assert.equal(parseOtpInput(link.replace('type=magiclink', 'type=recovery')), null);
  assert.equal(parseOtpInput('https://ref.supabase.co/auth/v1/verify?type=magiclink'), null);
});

test('email shape', () => {
  assert.equal(looksLikeEmail('a@b.co'), true);
  assert.equal(looksLikeEmail('a@b'), false);
  assert.equal(looksLikeEmail('nope'), false);
});
