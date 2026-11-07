/**
 * Pure helpers for the paged feed. Kept free of React Native imports so they
 * can be unit-tested with `node --test`.
 */

/** Number of pooled video players: the active item and one neighbour each side. */
export const POOL_SIZE = 3;

/**
 * Which item index each pooled player should hold for a given active index.
 * Slot = index % POOL_SIZE, so a player keeps its clip while it stays in the
 * window and is recycled for the item entering on the other side.
 * Unused slots are -1.
 */
export function poolWindow(active: number, count: number): number[] {
  const slots = Array<number>(POOL_SIZE).fill(-1);
  if (count <= 0) return slots;
  const start = Math.max(0, Math.min(active - 1, count - POOL_SIZE));
  for (let i = start; i < Math.min(start + POOL_SIZE, count); i++) slots[i % POOL_SIZE] = i;
  return slots;
}

/** Page index for a scroll offset, clamped to the list. */
export function indexFromOffset(offset: number, pageHeight: number, count: number): number {
  if (pageHeight <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset / pageHeight)));
}

/** True when an offset rests on a page boundary (no snap animation pending). */
export function isOnPage(offset: number, pageHeight: number): boolean {
  if (pageHeight <= 0) return false;
  const i = Math.round(offset / pageHeight);
  return Math.abs(offset - i * pageHeight) < 1;
}

/** Wide screens (iPad, landscape) get a centred 9:16 stage with a side rail. */
export function isWideLayout(width: number, height: number): boolean {
  return height > 0 && width / height > 0.62;
}
