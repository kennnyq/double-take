import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from './sha256.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('matches the standard test vectors', () => {
  assert.equal(new Sha256().hex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(new Sha256().update(enc('abc')).hex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    new Sha256().update(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).hex(),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('gives the same digest however the bytes are chunked', () => {
  const data = randomBytes(300_001);
  const want = createHash('sha256').update(data).digest('hex');
  for (const size of [1, 63, 64, 65, 4096, 1 << 20]) {
    const h = new Sha256();
    for (let i = 0; i < data.length; i += size) h.update(data.subarray(i, i + size));
    assert.equal(h.hex(), want, `chunks of ${size}`);
  }
});
