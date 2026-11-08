/**
 * Browser check that the double take's annotations are actually seen on the
 * desktop feed: on every clip with tells, the card and the Close button are
 * painted on top of the video (hiding them changes the screen).
 *
 * It caught the double take's inset turning the card's stage into a stacking
 * context: the overlay then sank under the pooled <video>, so the card,
 * spotlight and Close button showed only where the video was transparent
 * (letterbox bands) and vanished over portrait clips. Their opacity and state
 * were fine, so only pixels tell.
 *
 *   npm run e2e:overlay                                 (dev server on 8081)
 *   BASE_URL=http://localhost:8089 npm run e2e:overlay
 */
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

/** Whether hiding `selector`'s first match changes what's on screen in its box. */
async function painted(page: Page, selector: string): Promise<boolean | null> {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, selector);
  if (!box) return null;
  const shown = await page.screenshot({ clip: box });
  await page.evaluate((sel) => ((document.querySelector(sel) as HTMLElement).style.visibility = 'hidden'), selector);
  const hidden = await page.screenshot({ clip: box });
  await page.evaluate((sel) => ((document.querySelector(sel) as HTMLElement).style.visibility = ''), selector);
  return !shown.equals(hidden);
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await cacheFeed(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  await page.waitForTimeout(1500);

  let tested = 0;
  for (let clip = 0; clip < 8; clip++) {
    const button = await page.$('section.slide[aria-current="true"] [aria-label^="Double take"]');
    if (button) {
      await button.click();
      await page.waitForTimeout(3000);
      // Still frames, so the two screenshots differ only by what was hidden.
      await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
      await page.waitForTimeout(200);
      const card = await painted(page, '[data-testid="dt-card"]');
      const close = await painted(page, '[aria-label="Close the walkthrough"]');
      check(`clip ${clip}: the card and Close button are painted over the video`, card === true && close === true, { card, close });
      tested++;
      await page.click('[aria-label="Close the walkthrough"]').catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.click('[aria-label="Next video"]', { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1800);
  }
  check('several clips with tells were checked', tested >= 3, { tested });
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log('\nall passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
