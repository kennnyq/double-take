/**
 * Browser check that the wheel over a panel scrolls the panel, not the feed.
 * The desktop feed takes the wheel on the whole window, so the dev settings
 * panel, the Settings dialog and the comments panel must keep theirs: the
 * clip must not change while wheeling over them, at their scroll ends too and
 * over their parts that don't scroll. Wheeling over the clip itself must still
 * move the feed (so the check can fail).
 *
 *   npm run e2e:wheel                                  (dev server on 8081)
 *   BASE_URL=http://localhost:8087 npm run e2e:wheel
 *
 * Needs a running dev server (a dev build: the dev settings show only there)
 * and a Chromium (see browser.ts).
 */
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const failures: string[] = [];
let last = -1;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

/** Which clip the feed is on. */
const feedIndex = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('section.slide')].findIndex((s) => s.getAttribute('aria-current') === 'true'));

/** The middle of the first element matching `selector`, or of a part of it (fractions of its box). */
async function point(page: Page, selector: string, fx = 0.5, fy = 0.5) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Several trackpad-sized wheel bursts at a point, with time for the feed to react. */
async function wheel(page: Page, at: { x: number; y: number }, dy: number, times = 6) {
  // Each check compares with where the feed was just before its own wheel.
  last = await feedIndex(page);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
}

/** The scrollTop of the scrollable element under a point (or its nearest scrollable ancestor). */
const scrollTopAt = (page: Page, at: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    return el ? el.scrollTop : null;
  }, at);

const browser = await chromium.launch({ executablePath: findChrome() });
try {
  // Short enough that the dev panel's Colors tab has to scroll.
  const context = await browser.newContext({ viewport: { width: 1280, height: 620 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('section.slide[aria-current="true"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);

  // ---- the dev settings panel --------------------------------------------------------
  await page.getByRole('button', { name: /^Dev settings/ }).click();
  await page.getByRole('tab', { name: /^Colors/ }).click();
  await page.waitForTimeout(600);
  const panel = '[aria-label="Dev settings"]:has([aria-label="Find a setting"])';
  const body = await point(page, panel, 0.5, 0.6);
  const before = await scrollTopAt(page, body);
  await wheel(page, body, 80);
  const after = await scrollTopAt(page, body);
  check('dev panel: wheel over its body keeps the clip', (await feedIndex(page)) === last, { before: last, now: await feedIndex(page) });
  check('dev panel: and scrolls the panel', before !== null && after !== null && after > before, { before, after });

  await wheel(page, body, 400, 8); // on past its end
  check('dev panel: wheel past its end keeps the clip', (await feedIndex(page)) === last);
  await wheel(page, body, -400, 8); // and back past its top
  check('dev panel: wheel past its top keeps the clip', (await feedIndex(page)) === last);

  await wheel(page, await point(page, '[role="tablist"]'), 120);
  check('dev panel: wheel over its tabs keeps the clip', (await feedIndex(page)) === last);
  await wheel(page, await point(page, '[aria-label="Find a setting"]'), 120);
  check('dev panel: wheel over its search keeps the clip', (await feedIndex(page)) === last);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---- the Settings dialog -------------------------------------------------------------
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]');
  await page.waitForTimeout(500);
  await wheel(page, await point(page, '[role="dialog"][aria-label="Settings"]', 0.5, 0.7), 120);
  check('settings dialog: wheel over it keeps the clip', (await feedIndex(page)) === last);
  await wheel(page, { x: 40, y: 300 }, 120); // over its backdrop
  check('settings dialog: wheel over its backdrop keeps the clip', (await feedIndex(page)) === last);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ---- the comments panel ---------------------------------------------------------------
  await page.locator('section.slide[aria-current="true"] [aria-label^="Comments"]').first().click();
  await page.waitForSelector('aside.comments-panel');
  await page.waitForTimeout(500);
  await wheel(page, await point(page, 'aside.comments-panel', 0.5, 0.5), 120);
  check('comments panel: wheel over it keeps the clip', (await feedIndex(page)) === last);
  await wheel(page, await point(page, 'aside.comments-panel .cp-header'), 120);
  check('comments panel: wheel over its header keeps the clip', (await feedIndex(page)) === last);
  await page.locator('[aria-label="Close comments"]').click();
  await page.waitForTimeout(500);

  // ---- control: the wheel over the clip still moves the feed ---------------------------------
  await wheel(page, await point(page, 'section.slide[aria-current="true"]', 0.5, 0.5), 120, 3);
  const moved = await feedIndex(page);
  check('control: wheel over the clip moves the feed', moved !== last, { before: last, moved });
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
