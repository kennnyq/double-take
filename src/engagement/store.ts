import { settingsStorage } from '@/settings/storage';
import { createSignalStore } from './signals';

/** What the viewer did with each clip on this device (likes, saves, game answers, …). */
export const signals = createSignalStore(settingsStorage);
