import type { ReactNode } from 'react';

/**
 * The apps open straight on the feed; only the web has a landing page in front
 * (`WithLanding.web.tsx`), so there is no `showLanding` to pass on.
 */
export function WithLanding({
  children,
}: {
  children(startAt: number | undefined, showLanding?: () => void): ReactNode;
}) {
  return children(undefined);
}
