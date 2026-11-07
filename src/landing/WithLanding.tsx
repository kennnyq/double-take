import type { ReactNode } from 'react';

/**
 * The apps open straight on the feed; only the web has a landing page in front
 * (`WithLanding.web.tsx`).
 */
export function WithLanding({ children }: { children(startAt: number | undefined): ReactNode }) {
  return children(undefined);
}
