/** Shared UUID plus 128 secure bits: private links stay unpredictable even if
 * the general-purpose UUID helper reaches its non-security fallback. */
export function uploadId(nextUuid: () => string, fill: (bytes: Uint8Array) => unknown): string {
  const id = nextUuid().replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Could not create an upload identifier.');
  const bytes = new Uint8Array(16);
  fill(bytes);
  return id + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
