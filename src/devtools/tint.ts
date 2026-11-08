import { themed } from '@/ui/theme';

/** The dev panel's palette colours, shared by its tabs. */
export const useDevTint = themed((c) => ({
  accentText: { color: c.accent },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipTextOn: { color: c.onAccent },
  launcherOpen: { backgroundColor: c.accent, borderColor: c.accent, borderStyle: 'solid' },
  badge: { backgroundColor: c.accent },
  badgeText: { color: c.onAccent },
  tabIndicator: { backgroundColor: c.accent },
  tabLabelOn: { color: c.onAccent },
}));
