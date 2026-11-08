/** Shared by the browser checks in scripts/e2e/. */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The dev server to test (main's is on 8081). */
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8081';

/** CHROME_PATH, else any Playwright Chromium in the cache, else Playwright's own (undefined). */
export function findChrome(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(cache, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
