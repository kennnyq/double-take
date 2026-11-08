import { StyleSheet } from 'react-native';
import { themed } from '@/ui/theme';

/** A palette colour (`#rrggbb`) at some opacity. */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The double take's dark glass (info cards, the Close button) and its text,
 * from the live palette: the surface colour, translucent over a blur, with
 * the palette's text and its `tell` colour for the loop line.
 */
export const useGlass = themed((c) => ({
  glass: { borderColor: alpha(c.text, 0.1), borderWidth: StyleSheet.hairlineWidth },
  tint: { backgroundColor: alpha(c.surface, 0.62) },
  button: { backgroundColor: alpha(c.surface, 0.58), borderColor: alpha(c.text, 0.18), borderWidth: StyleSheet.hairlineWidth },
  text: { color: alpha(c.text, 0.94) },
  hint: { color: alpha(c.textDim, 0.75) },
  track: { backgroundColor: alpha(c.tell, 0.14) },
  fill: { backgroundColor: alpha(c.tell, 0.6) },
}));
