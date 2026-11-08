import { useSyncExternalStore } from 'react';
import { Platform, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { devStorage } from '@/devtools/storage';
import { DEV_TOOLS } from '@/devtools/store';
import { DEFAULT_PALETTE, PALETTES, cssVariables, parsePaletteId, type Palette, type PaletteId } from './palettes';

export { DEFAULT_PALETTE, LEGACY_PALETTES, PALETTES, PALETTE_IDS, type Palette, type PaletteId } from './palettes';

/**
 * The live palette. Builds ship `DEFAULT_PALETTE`; where the dev tools show
 * (dev builds), Dev settings → Colors can switch it at runtime,
 * and the pick is kept on the device.
 */
const STORAGE_KEY = 'double-take:palette:v1';

function readStored(): PaletteId {
  if (!DEV_TOOLS) return DEFAULT_PALETTE;
  try {
    return parsePaletteId(devStorage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

let current: Palette = PALETTES[readStored()];
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => current;

export function getPalette(): Palette {
  return current;
}

export function setPalette(id: PaletteId) {
  if (id === current.id) return;
  current = PALETTES[id];
  try {
    devStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // Not saved; it still applies until the app reloads.
  }
  applyCss(current);
  listeners.forEach((l) => l());
}

/** The live palette; re-renders when it's switched. */
export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Styles that use palette colours. Returns a hook that gives the styles for the
 * live palette (each palette's sheet is built once):
 *
 *   const useTint = themed((c) => ({ chipOn: { backgroundColor: c.accent } }));
 *   function Chip() { const tint = useTint(); … }
 */
export function themed<T extends Styles>(make: (c: Palette) => T): () => Readonly<T> {
  const sheets = new Map<PaletteId, Readonly<T>>();
  return function useThemedStyles() {
    const p = usePalette();
    let s = sheets.get(p.id);
    if (!s) {
      s = StyleSheet.create(make(p));
      sheets.set(p.id, s);
    }
    return s;
  };
}

/** Web: the palette as `--dt-*` custom properties on <html>, for desktop.css and the landing. */
function applyCss(p: Palette) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVariables(p))) root.style.setProperty(k, v);
  root.dataset.palette = p.id;
}

applyCss(current);
