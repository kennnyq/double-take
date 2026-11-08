import * as Crypto from 'expo-crypto';
import { makeUuid, type RandomSource } from './uuidCore';

/**
 * expo-crypto: native random ids and bytes where the JS engine has no
 * `crypto` (Hermes). On web it wraps the browser's `crypto`, whose
 * `randomUUID` is missing over plain HTTP; `makeUuid` then falls through to
 * `getRandomValues`, which works there.
 */
const expoCrypto: RandomSource = {
  randomUUID: () => Crypto.randomUUID(),
  getRandomValues: (bytes) => Crypto.getRandomValues(bytes),
};

/**
 * A random v4 UUID, on every platform and on plain-HTTP dev links too. Use it
 * instead of `crypto.randomUUID()` / `Crypto.randomUUID()` in app code.
 */
export function uuid(): string {
  const web = (globalThis as { crypto?: RandomSource }).crypto;
  return makeUuid([web, expoCrypto]);
}
