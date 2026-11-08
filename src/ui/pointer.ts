import { Platform } from 'react-native';

/**
 * "Click" where the main pointer is a mouse or trackpad (fine pointer that can
 * hover), "Tap" on touch screens and in the apps. Decided by input type, not
 * screen size: a small desktop window still clicks, a big tablet still taps.
 */
export function pointerVerb(): 'Click' | 'Tap' {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'Tap';
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches ? 'Click' : 'Tap';
}
