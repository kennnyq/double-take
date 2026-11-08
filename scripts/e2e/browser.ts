import type { Page } from 'playwright-core';
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

// Keep the same successfully fetched clips across reloads/contexts in one test
// run. These are gesture tests; an intermittent remote feed timeout would
// otherwise replace the feed with placeholders that have no walkthroughs.
const feeds = new Map<string, string>();
export async function cacheFeed(page: Page): Promise<void> {
  await page.route('**/feed', async (route) => {
    const key = route.request().url();
    const cached = feeds.get(key);
    if (cached !== undefined) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: cached });
      return;
    }
    const response = await route.fetch();
    if (response.ok()) feeds.set(key, await response.text());
    await route.fulfill({ response });
  });
}
