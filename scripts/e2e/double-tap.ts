/**
 * Browser check for opening the double take with a double click (desktop) or
 * double tap (phone layout, touch): it must open without the first click or
 * tap pausing the clip on the way, a lone click must still pause after the
 * double-tap window, and in Hold mode a click must pause at once.
 *
 *   npm run e2e:taps                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8086 npm run e2e:taps
 *
 * Needs a running dev server and a Chromium (see browser.ts). Every `pause`
 * event on any <video> is recorded, so a stray pause can't slip by unseen
 * (except the double take's own while it scrubs to a tell).
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';

const SETTINGS_KEY = 'double-take.settings.v1';
const CLOSE_WALKTHROUGH = '[aria-label="Close the walkthrough"]';

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

type Layout = 'desktop' | 'phone';

async function open(browser: Browser, layout: Layout, revealGesture: 'hold' | 'doubleTap' | 'both') {
  const context = await browser.newContext(
    layout === 'desktop'
      ? { viewport: { width: 1280, height: 800 } }
      : { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
  );
  const page = await context.newPage();
  await cacheFeed(page);
  await page.addInitScript(
    ([key, gesture]) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify({ revealGesture: gesture }));
      // Every pause of any video, with when it happened.
      const w = window as unknown as { __pauses: number[] };
      w.__pauses = [];
      document.addEventListener('pause', (e) => e.target instanceof HTMLVideoElement && w.__pauses.push(performance.now()), true);
    },
    [SETTINGS_KEY, revealGesture] as const,
  );
  await page.goto(`${BASE_URL}/#app`);
  // The first clip has tells: its Double take button shows.
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  return page;
}

/** The middle of the active clip's video, where taps land. */
async function videoPoint(page: Page, layout: Layout) {
  const sel = layout === 'desktop' ? 'section.slide[aria-current="true"] .tap-layer' : '[aria-label="Pause"], [aria-label="Play"]';
  const box = await page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.top > -5 && r.top < 60 && r.height > 300;
    });
    const r = el!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
  }, sel);
  return box;
}

/**
 * Pauses so far, leaving out the double take's own: it holds the clip paused
 * while it scrubs to a tell (logged to `__dtMarks` in dev builds).
 */
async function pauses(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __pauses: number[]; __dtMarks?: { kind: string; at: number }[] };
    const marks = w.__dtMarks ?? [];
    const windows = marks.flatMap((m, i) => {
      if (m.kind !== 'scrubStart') return [];
      const end = marks.slice(i + 1).find((e) => e.kind === 'scrubEnd')?.at ?? Infinity;
      return [[m.at - 50, end + 50]];
    });
    return w.__pauses.filter((t) => !windows.some(([a, z]) => t >= a && t <= z)).length;
  });
}
const isOpen = (page: Page) => page.evaluate((s) => !!document.querySelector(s), CLOSE_WALKTHROUGH);

async function twice(page: Page, layout: Layout, x: number, y: number) {
  if (layout === 'desktop') {
    await page.mouse.dblclick(x, y);
  } else {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(x, y);
  }
}
async function once(page: Page, layout: Layout, x: number, y: number) {
  if (layout === 'desktop') await page.mouse.click(x, y);
  else await page.touchscreen.tap(x, y);
}

async function run(browser: Browser, layout: Layout) {
  const word = layout === 'desktop' ? 'click' : 'tap';
  for (const gesture of ['doubleTap', 'both'] as const) {
    const page = await open(browser, layout, gesture);
    const { x, y } = await videoPoint(page, layout);

    // Double: opens, with no pause on the way.
    const before = await pauses(page);
    await twice(page, layout, x, y);
    await page.waitForTimeout(1500);
    check(`${layout} ${gesture}: double ${word} opens the double take without pausing`, (await isOpen(page)) && (await pauses(page)) === before, {
      open: await isOpen(page),
      pauses: (await pauses(page)) - before,
    });
    await page.click(CLOSE_WALKTHROUGH);
    await page.waitForTimeout(800);

    // Single: pauses, but only after the double-tap window.
    const p0 = await pauses(page);
    await once(page, layout, x, y);
    await page.waitForTimeout(100);
    const early = (await pauses(page)) - p0;
    await page.waitForTimeout(400);
    const late = (await pauses(page)) - p0;
    check(`${layout} ${gesture}: a single ${word} pauses after the window`, early === 0 && late === 1 && !(await isOpen(page)), { early, late });
    await once(page, layout, x, y); // play again
    await page.context().close();
  }

  // Hold mode: a single click/tap pauses at once.
  const page = await open(browser, layout, 'hold');
  const { x, y } = await videoPoint(page, layout);
  const p0 = await pauses(page);
  await once(page, layout, x, y);
  await page.waitForTimeout(100);
  check(`${layout} hold: a single ${word} pauses at once`, (await pauses(page)) - p0 === 1, { pauses: (await pauses(page)) - p0 });
  await page.context().close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome() });
  await run(browser, 'desktop');
  await run(browser, 'phone');
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
