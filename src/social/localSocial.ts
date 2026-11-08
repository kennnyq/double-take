import { settingsStorage } from '@/settings/storage';
import { parseLocalRows, toLocalRows } from './localRows';
import type { SocialState } from './reducer';
import type { MineRows } from './sync';

/** A guest's likes, saves, reposts, sends, follows and comments, on this device only. */
const KEY = 'double-take.guest-social.v1';

export function readLocalRows(): MineRows {
  try {
    return parseLocalRows(settingsStorage?.getItem(KEY));
  } catch {
    return parseLocalRows(null);
  }
}

export function writeLocalRows(state: SocialState) {
  try {
    settingsStorage?.setItem(KEY, JSON.stringify(toLocalRows(state)));
  } catch (e) {
    console.warn(`[social] couldn't save on this device: ${e instanceof Error ? e.message : e}`);
  }
}
