import type { KeyValue } from './settings';

/** Web: this browser's `localStorage` (null where it's blocked; settings then last the session). */
export const devStorage: KeyValue | null = (() => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
})();
