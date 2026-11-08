/**
 * Random v4 UUIDs (RFC 4122) wherever the app runs. Pure (no React Native),
 * so it runs under `node --test`; `uuid.ts` gives it the device's sources.
 *
 * `crypto.randomUUID()` exists only in secure contexts (HTTPS, localhost): on
 * a plain-HTTP dev link (the tailnet) it's missing, and expo-crypto's web
 * build, which calls it, throws. `crypto.getRandomValues()` works over HTTP,
 * so a v4 UUID is built from that instead. Last of all (no source at all),
 * `Math.random` still makes a well-formed, unique-enough id; never use that
 * one for anything secret.
 */

/** Anything that can give random ids or bytes, e.g. `globalThis.crypto` or expo-crypto. */
export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

/** The canonical v4 layout: 8-4-4-4-12 hex, version nibble 4, variant 10xx. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A v4 UUID from 16 random bytes (they're stamped with the version and variant). */
export function v4FromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A v4 UUID from the first source that can make one: a source's own
 * `randomUUID`, else its `getRandomValues`, else `random` (Math.random). A
 * source that throws (expo-crypto's web `randomUUID` over HTTP) is skipped.
 */
export function makeUuid(sources: readonly (RandomSource | null | undefined)[], random: () => number = Math.random): string {
  for (const s of sources) {
    if (typeof s?.randomUUID !== 'function') continue;
    try {
      const id = s.randomUUID();
      if (typeof id === 'string' && UUID_V4.test(id.toLowerCase())) return id.toLowerCase();
    } catch {
      // Not in a secure context, or not really there: try the next.
    }
  }
  for (const s of sources) {
    if (typeof s?.getRandomValues !== 'function') continue;
    try {
      return v4FromBytes(s.getRandomValues(new Uint8Array(16)));
    } catch {
      // Unavailable here: try the next.
    }
  }
  return v4FromBytes(Uint8Array.from({ length: 16 }, () => Math.floor(random() * 256) & 0xff));
}
