import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadId } from './upload-id.ts';
import { makeUuid } from '../lib/uuidCore.ts';
test('upload ID path uses shared UUID core on HTTP with randomUUID absent', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let called = 0;
  const crypto = { randomUUID: undefined, getRandomValues(bytes: Uint8Array) { called++; for (let i = 0; i < bytes.length; i++) bytes[i] = i; return bytes; } };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  try {
    assert.equal(uploadId(() => makeUuid([crypto]), bytes => crypto.getRandomValues(bytes)), '000102030405460788090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f');
    assert.equal(called, 2);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else Reflect.deleteProperty(globalThis, 'crypto'); }
});
test('weak fallback is available only for non-security UUIDs; upload entropy failures propagate', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try { assert.match(makeUuid([]), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else Reflect.deleteProperty(globalThis, 'crypto'); }
  assert.throws(() => uploadId(() => makeUuid([]), () => { throw Error('Unavailable'); }), /Unavailable/);
});
