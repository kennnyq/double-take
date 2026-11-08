import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { makeUuid, UUID_V4, v4FromBytes, type RandomSource } from './uuidCore.ts';

const unique = (make: () => string, n = 2000) => {
  const ids = Array.from({ length: n }, make);
  for (const id of ids) assert.match(id, UUID_V4);
  assert.equal(new Set(ids).size, n, 'no repeats');
};

test('uses randomUUID where the context has it (HTTPS, localhost)', () => {
  let calls = 0;
  const secure: RandomSource = {
    randomUUID: () => {
      calls++;
      return webcrypto.randomUUID();
    },
    getRandomValues: () => assert.fail('not needed'),
  };
  unique(() => makeUuid([secure]));
  assert.equal(calls, 2000);
});

test('without randomUUID (plain HTTP), builds a v4 from getRandomValues', () => {
  const http: RandomSource = { getRandomValues: (b) => webcrypto.getRandomValues(b) };
  unique(() => makeUuid([http]));
});

test('a randomUUID that throws (expo-crypto on web over HTTP) falls through', () => {
  const throwing: RandomSource = {
    randomUUID: () => {
      throw new TypeError('crypto.randomUUID is not a function');
    },
    getRandomValues: (b) => webcrypto.getRandomValues(b),
  };
  unique(() => makeUuid([throwing]));
});

test('the next source steps in when the first has nothing (native without a global crypto)', () => {
  let used = 0;
  const native: RandomSource = {
    randomUUID: () => {
      used++;
      return webcrypto.randomUUID();
    },
  };
  unique(() => makeUuid([undefined, {}, native]), 50);
  assert.equal(used, 50);
});

test('with no source at all, Math.random still gives well-formed, distinct ids', () => {
  unique(() => makeUuid([]));
  unique(() => makeUuid([null, {}]), 200);
});

test('v4FromBytes stamps the version and variant whatever the bytes', () => {
  assert.equal(v4FromBytes(new Uint8Array(16)), '00000000-0000-4000-8000-000000000000');
  assert.equal(v4FromBytes(new Uint8Array(16).fill(255)), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('a source returning something that is not a UUID is not trusted', () => {
  const odd: RandomSource = { randomUUID: () => 'nope', getRandomValues: (b) => webcrypto.getRandomValues(b) };
  assert.match(makeUuid([odd]), UUID_V4);
});
