import Storage from 'expo-sqlite/kv-store';
import type { KeyValue } from './settings';

/**
 * Devices: SQLite's key-value store, read synchronously so settings apply from
 * the first frame. The store catches anything these throw.
 */
export const settingsStorage: KeyValue | null = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
};
