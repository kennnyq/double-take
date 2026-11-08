/**
 * Browser check for the first-run hints over the feed: a brand-new phone
 * viewer gets "Swipe up" first, then the double take hint for the gesture they
 * picked; the hint goes as soon as a double take opens, comes back on reload
 * until two have been opened, and then never again. Desktop (a fine pointer)
 * gets the mouse and keyboard version and no swipe hint. Reduce Motion gets a
 * still icon.
 *
 *   npm run e2e:hint                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8093 npm run e2e:hint
 *   FRAMES=/abs/dir npm run e2e:hint                    (also saves a frame strip of each hint)
 *
 * Needs a running dev server and a Chromium (see browser.ts).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const SETTINGS_KEY = 'double-take.settings.v1';
const HINTS_KEY = 'double-take.hints.v1';
const DEV_HINTS_KEY = 'double-take:dev-hints:v1';
const HINT = '[data-testid="gesture-hint"]';
const CLOSE_WALKTHROUGH = '[aria-label="Close the walkthrough"]';

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

type Layout = 'desktop' | 'phone';
const CONTEXT: Record<Layout, BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
};

interface Start {
  gesture?: 'hold' | 'doubleTap' | 'both';
  hints?: { opens: number; swiped: boolean };
  dev?: { force: string; style: string };
  reducedMotion?: boolean;
}

/** A fresh browser, storage seeded once (a reload keeps what the app saved since). */
async function open(browser: Browser, layout: Layout, start: Start = {}) {
  const context = await browser.newContext({ ...CONTEXT[layout], reducedMotion: start.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  await page.addInitScript(
    ([seed]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(seed)) if (v) localStorage.setItem(k, v);
    },
    [
      {
        [SETTINGS_KEY]: JSON.stringify({ revealGesture: start.gesture ?? 'hold' }),
        [HINTS_KEY]: start.hints ? JSON.stringify(start.hints) : '',
        [DEV_HINTS_KEY]: start.dev ? JSON.stringify(start.dev) : '',
      },
    ] as const,
  );
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  return page;
}

/** The hint's spoken words once it shows, or null if it doesn't within `ms`. */
async function hintWithin(page: Page, ms: number): Promise<string | null> {
  try {
    await page.waitForSelector(HINT, { timeout: ms });
    return await page.getAttribute(HINT, 'aria-label');
  } catch {
    return null;
  }
}
const hintGone = (page: Page, ms: number) =>
  page.waitForSelector(HINT, { state: 'detached', timeout: ms }).then(
    () => true,
    () => false,
  );
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), HINTS_KEY);

/** Opens the active clip's double take with its button, then closes it. */
async function openDoubleTake(page: Page, layout: Layout) {
  const button = layout === 'desktop' ? 'section.slide[aria-current="true"] [aria-label^="Double take"]' : '[aria-label^="Double take"]';
  const el = page.locator(button).first();
  if (layout === 'phone') await el.tap();
  else await el.click();
  await page.waitForSelector(CLOSE_WALKTHROUGH, { timeout: 10_000 });
}

async function phoneFlow(browser: Browser) {
  const page = await open(browser, 'phone');
  check('phone, brand-new: the swipe hint shows first', (await hintWithin(page, 6000)) === 'Swipe up', await page.getAttribute(HINT, 'aria-label').catch(() => null));
  check('phone: it fades out on its own', await hintGone(page, 12_000));
  check('phone: seen through, the swipe is learned', (await stored(page))?.swiped === true, await stored(page));
  await page.reload();
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  check('phone, next session: the hold hint shows', (await hintWithin(page, 6000)) === 'Hold');
  await openDoubleTake(page, 'phone');
  check('phone: opening a double take dismisses it', await hintGone(page, 2000));
  check('phone: one open counted', (await stored(page))?.opens === 1, await stored(page));
  await page.reload();
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  check('phone: back on the next session until learned', (await hintWithin(page, 6000)) === 'Hold');
  await openDoubleTake(page, 'phone');
  check('phone: two opens counted', (await stored(page))?.opens === 2, await stored(page));
  await page.reload();
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  check('phone: learned, it never shows again', (await hintWithin(page, 5000)) === null);
  await page.context().close();
}

async function desktopFlow(browser: Browser) {
  for (const [gesture, words] of [
    ['hold', 'Hold Space'],
    ['doubleTap', 'Double-click'],
    ['both', 'Double-click, Hold Space'],
  ] as const) {
    const page = await open(browser, 'desktop', { gesture });
    check(`desktop ${gesture}: no swipe hint, "${words}" instead`, (await hintWithin(page, 6000)) === words, await page.getAttribute(HINT, 'aria-label').catch(() => null));
    if (gesture === 'hold') {
      await page.locator('section.slide[aria-current="true"] .tap-layer').click({ position: { x: 20, y: 20 } }).catch(() => {});
      // Hold Space: the gesture itself.
      await page.keyboard.down('Space');
      await page.waitForTimeout(700);
      await page.keyboard.up('Space');
      const opened = await page.evaluate((s) => !!document.querySelector(s), CLOSE_WALKTHROUGH);
      check('desktop: holding Space opens it and dismisses the hint', opened && (await hintGone(page, 2000)), { opened });
    }
    await page.context().close();
  }
}

async function reducedMotion(browser: Browser) {
  const page = await open(browser, 'phone', { gesture: 'both', hints: { opens: 0, swiped: true }, reducedMotion: true });
  const words = await hintWithin(page, 6000);
  const still = await page.locator(HINT).innerText().catch(() => '');
  check('Reduce Motion: a still icon with both captions', words === 'Double tap, Hold' && still.includes('Double tap · Hold'), { words, still });
  await page.context().close();
}

/** FRAMES=dir: a strip of frames across one loop of each hint, for review. */
async function frames(browser: Browser, dir: string) {
  mkdirSync(dir, { recursive: true });
  const variants: { name: string; layout: Layout; start: Start; loopMs: number }[] = [
    { name: 'touch-hold', layout: 'phone', start: { gesture: 'hold', dev: { force: 'doubleTake', style: 'touch' } }, loopMs: 2800 },
    { name: 'touch-double-tap', layout: 'phone', start: { gesture: 'doubleTap', dev: { force: 'doubleTake', style: 'touch' } }, loopMs: 2200 },
    { name: 'touch-both', layout: 'phone', start: { gesture: 'both', dev: { force: 'doubleTake', style: 'touch' } }, loopMs: 5000 },
    { name: 'touch-swipe', layout: 'phone', start: { dev: { force: 'swipe', style: 'touch' } }, loopMs: 2100 },
    { name: 'desktop-hold-space', layout: 'desktop', start: { gesture: 'hold', dev: { force: 'doubleTake', style: 'auto' } }, loopMs: 2800 },
    { name: 'desktop-double-click', layout: 'desktop', start: { gesture: 'doubleTap', dev: { force: 'doubleTake', style: 'auto' } }, loopMs: 2200 },
    { name: 'still-both', layout: 'phone', start: { gesture: 'both', dev: { force: 'doubleTake', style: 'still' } }, loopMs: 0 },
  ];
  for (const v of variants) {
    const page = await open(browser, v.layout, v.start);
    await page.waitForSelector(HINT, { timeout: 8000 });
    await page.waitForTimeout(600);
    const box = (await page.locator(HINT).boundingBox())!;
    const pad = 28;
    const clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
    const n = v.loopMs ? 10 : 1;
    const shots: string[] = [];
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const wait = t0 + (i * v.loopMs) / n - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      shots.push((await page.screenshot({ clip })).toString('base64'));
    }
    const strip = await page.context().newPage();
    await strip.setViewportSize({ width: Math.ceil(clip.width) * Math.min(n, 5) + 8 * 6, height: Math.ceil(clip.height) * Math.ceil(n / 5) + 8 * 3 });
    await strip.setContent(
      `<body style="margin:0;padding:8px;background:#000;display:flex;flex-wrap:wrap;gap:8px">${shots
        .map((b) => `<img src="data:image/png;base64,${b}" style="width:${Math.ceil(clip.width)}px;height:${Math.ceil(clip.height)}px">`)
        .join('')}</body>`,
    );
    const out = join(dir, `${v.name}.png`);
    await strip.screenshot({ path: out, fullPage: true });
    console.log(`frames ${out}`);
    await page.context().close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome() });
  if (process.env.FRAMES) await frames(browser, process.env.FRAMES);
  if (process.env.FRAMES_ONLY) return browser.close();
  await phoneFlow(browser);
  await desktopFlow(browser);
  await reducedMotion(browser);
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
