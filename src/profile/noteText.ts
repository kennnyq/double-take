/**
 * Profile notes (like Instagram's): a short line in the bubble over your
 * avatar. Pure, for `node --test`.
 */
export const NOTE_MAX = 60;

/** What gets saved: spaces tidied, at most 60 characters; empty clears it (null). */
export function normalizeNote(raw: string | null | undefined): string | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Count characters, not UTF-16 units, so an emoji isn't cut in half.
  return Array.from(t).slice(0, NOTE_MAX).join('').trim() || null;
}
