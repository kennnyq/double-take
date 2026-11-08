import { themed } from '@/ui/theme';

/**
 * The dev panel's colours: neutral greys from the live palette's surfaces and
 * text, never its accent or any other hue (not even red for a reset), so the
 * panel reads as a tool over the app (as the landing's design bar does) and
 * looks the same whichever palette is on trial.
 */
export const useDevChrome = themed((c) => ({
  panel: { backgroundColor: c.surface, borderColor: 'rgba(255,255,255,0.09)' },
  raised: { backgroundColor: c.surfaceRaised },
  text: { color: c.text },
  dim: { color: c.textDim },
  /** The picked chip, tab and the open launcher: light on the dark panel. */
  on: { backgroundColor: c.text },
  onText: { color: c.bg },
  border: { borderColor: 'rgba(255,255,255,0.14)' },
  // Kept for AccountsTab's chips.
  chipOn: { backgroundColor: c.text, borderColor: c.text },
  chipTextOn: { color: c.bg },
}));

/** How long the panel's moves take: opening, closing, switching tabs, sliding a pick. */
export const DEV_EASE_MS = 240;
