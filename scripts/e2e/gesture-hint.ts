/**
 * Browser check for the first-run gesture hint over the feed: one hint for
 * both ways into the double take (Both is the default), "Hold or double tap"
 * on phones and "Hold spacebar or double click" on desktop (a fine pointer). It goes as soon as either gesture opens a double take, comes
 * back on reload until two have been opened, and then never again. Entering
 * from the landing's hero, it waits for the hand-off. Reduce Motion gets a
 * still frame. Dev settings → Interaction → Gesture hint plays it now, in the
 * picked design.
 *
 * It also checks the hint is actually seen: hiding it must change the screen.
 * That caught the desktop hint painting under the pooled <video> (its stage
 * was a stacking context), where it was in the page, opaque and invisible.
 *
 *   npm run e2e:hint                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8086 npm run e2e:hint
 *   PIXELS_ONLY=1 npm run e2e:hint                      (only the is-it-seen checks)
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
const DESKTOP_BOTH = 'Hold spacebar or double click';
const PHONE_BOTH = 'Hold or double tap';

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
  hints?: { opens: number };
  dev?: { force?: string; design?: string; input?: string };
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
        [SETTINGS_KEY]: start.gesture ? JSON.stringify({ revealGesture: start.gesture }) : '',
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

/**
 * Whether the hint is actually seen: with every video paused (so only the hint
 * can change), hiding it must change the screen in its box. Being in the page,
 * opaque and on top in the DOM isn't enough; a stacking context can still sink
 * it under the video.
 */
async function hintPainted(page: Page): Promise<boolean | null> {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, HINT);
  if (!box) return null;
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
  await page.waitForTimeout(200);
  const shown = await page.screenshot({ clip: box });
  await page.evaluate((sel) => ((document.querySelector(sel) as HTMLElement).style.visibility = 'hidden'), HINT);
  const hidden = await page.screenshot({ clip: box });
  await page.evaluate((sel) => ((document.querySelector(sel) as HTMLElement).style.visibility = ''), HINT);
  return !shown.equals(hidden);
}

/** Opens the active clip's double take with its button. */
async function openDoubleTake(page: Page, layout: Layout) {
  const button = layout === 'desktop' ? 'section.slide[aria-current="true"] [aria-label^="Double take"]' : '[aria-label^="Double take"]';
  const el = page.locator(button).first();
  if (layout === 'phone') await el.tap();
  else await el.click();
  await page.waitForSelector(CLOSE_WALKTHROUGH, { timeout: 10_000 });
}

async function phoneFlow(browser: Browser) {
  const page = await open(browser, 'phone');
  check('phone, brand-new: hold then double tap (Both, the default), no swipe hint', (await hintWithin(page, 4000)) === PHONE_BOTH, await page.getAttribute(HINT, 'aria-label').catch(() => null));
  await openDoubleTake(page, 'phone');
  check('phone: opening a double take dismisses it', await hintGone(page, 2000));
  check('phone: one open counted', (await stored(page))?.opens === 1, await stored(page));
  await page.reload();
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  check('phone: back on the next session until learned', (await hintWithin(page, 4000)) === PHONE_BOTH);
  // The other way in: a double tap on the video.
  const v = (await page.locator('[aria-label="Pause"], [aria-label="Play"]').first().boundingBox())!;
  await page.touchscreen.tap(v.x + v.width / 2, v.y + v.height / 3);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(v.x + v.width / 2, v.y + v.height / 3);
  await page.waitForSelector(CLOSE_WALKTHROUGH, { timeout: 10_000 });
  check('phone: a double tap dismisses it too', await hintGone(page, 2000));
  check('phone: two opens counted', (await stored(page))?.opens === 2, await stored(page));
  await page.reload();
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  check('phone: learned, it never shows again', (await hintWithin(page, 4000)) === null);
  await page.context().close();
}

async function timesOut(browser: Browser) {
  const page = await open(browser, 'phone', { gesture: 'hold' });
  check('phone hold: just the hold', (await hintWithin(page, 4000)) === 'Hold');
  check('it fades out on its own after a couple of loops', await hintGone(page, 12_000));
  await page.context().close();
}

async function desktopFlow(browser: Browser) {
  for (const [gesture, words] of [
    ['hold', 'Hold spacebar'],
    ['doubleTap', 'Double click'],
    [undefined, DESKTOP_BOTH],
  ] as const) {
    const page = await open(browser, 'desktop', { gesture });
    check(`desktop ${gesture ?? 'default (both)'}: "${words}"`, (await hintWithin(page, 4000)) === words, await page.getAttribute(HINT, 'aria-label').catch(() => null));
    await page.context().close();
  }
  // With Both, either gesture dismisses it.
  for (const how of ['space', 'dblclick'] as const) {
    const page = await open(browser, 'desktop');
    await hintWithin(page, 4000);
    const layer = page.locator('section.slide[aria-current="true"] .tap-layer');
    if (how === 'space') {
      await page.keyboard.down('Space');
      await page.waitForTimeout(700);
      await page.keyboard.up('Space');
    } else {
      await layer.dblclick({ position: { x: 120, y: 200 } });
    }
    const opened = await page.waitForSelector(CLOSE_WALKTHROUGH, { timeout: 5000 }).then(
      () => true,
      () => false,
    );
    check(`desktop: ${how === 'space' ? 'holding Space' : 'a double-click'} opens it and dismisses the hint`, opened && (await hintGone(page, 2000)), { opened });
    await page.context().close();
  }
}

/** Is it seen, over the video: desktop (direct, from the hero, with the dev panel open) and phone. */
async function pixels(browser: Browser) {
  for (const layout of ['desktop', 'phone'] as const) {
    const page = await open(browser, layout);
    const words = await hintWithin(page, 4000);
    await page.waitForTimeout(800);
    const seen = await hintPainted(page);
    check(`${layout}: the hint is painted over the video, not under it`, words !== null && seen === true, { words, seen });
    await page.context().close();
  }
  // The dev settings panel floats beside the desktop card: the hint still shows, and is seen.
  const page = await open(browser, 'desktop');
  await page.keyboard.press('Control+.');
  await page.getByText('Gesture hint', { exact: true }).waitFor({ timeout: 5000 });
  const words = await hintWithin(page, 4000);
  await page.waitForTimeout(800);
  const seen = await hintPainted(page);
  check('desktop: with the dev settings panel open, the hint still shows over the video', words === DESKTOP_BOTH && seen === true, { words, seen });
  await page.context().close();
  await fromHero(browser, ['desktop'], true);
}

/** Dev settings → Interaction → Gesture hint: the design picker and Show now, even once learned. */
async function devPanel(browser: Browser) {
  const page = await open(browser, 'desktop', { hints: { opens: 2 } });
  check('learned: no hint by itself', (await hintWithin(page, 3000)) === null);
  await page.keyboard.press('Control+.');
  await page.getByText('Gesture hint', { exact: true }).waitFor({ timeout: 5000 });
  check('dev panel: Interaction has a Gesture hint section', true);
  check('dev panel: no swipe hint option', (await page.getByText('Show the swipe hint now', { exact: true }).count()) === 0);
  await page.getByText('Finger', { exact: true }).click();
  await page.getByText('Show now', { exact: true }).click();
  const words = await hintWithin(page, 3000);
  const design = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').design, DEV_HINTS_KEY);
  check('dev panel: Show now plays it, in the picked design', words === DESKTOP_BOTH && design === 'finger', { words, design });
  await page.context().close();
}

/** Entering through the landing's launch: no hint under the landing, then one soon after the hand-off. */
async function fromHero(browser: Browser, layouts: readonly Layout[] = ['desktop', 'phone'], pixelCheck = false) {
  for (const layout of layouts) {
    const context = await browser.newContext(CONTEXT[layout]);
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
    });
    await page.goto(`${BASE_URL}/`);
    const cta = page.locator('.lt-cta').first();
    await cta.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    if (layout === 'phone') await cta.tap();
    else await cta.click();
    // Sample until the app has the page to itself.
    let underLanding = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const st = await page.evaluate((hint) => ({ app: location.hash === '#app', hint: !!document.querySelector(hint) }), HINT);
      if (!st.app && st.hint) underLanding = true;
      if (st.app) break;
      await page.waitForTimeout(100);
    }
    const handedOff = Date.now();
    const words = await hintWithin(page, 3000);
    const after = Date.now() - handedOff;
    const want = layout === 'phone' ? PHONE_BOTH : DESKTOP_BOTH;
    if (pixelCheck) {
      await page.waitForTimeout(800);
      const seen = await hintPainted(page);
      check(`${layout}: from the hero, the hint is painted over the video`, words === want && seen === true, { words, seen });
    } else {
      check(`${layout}: from the hero, the hint waits for the hand-off, then shows (${after} ms)`, !underLanding && words === want && after < 2000, { underLanding, words, after });
    }
    await context.close();
  }
}

async function reducedMotion(browser: Browser) {
  const page = await open(browser, 'phone', { gesture: 'both', reducedMotion: true });
  const words = await hintWithin(page, 4000);
  const still = await page.locator(HINT).innerText().catch(() => '');
  check('Reduce Motion: a still frame with its caption', words === PHONE_BOTH && still.includes(PHONE_BOTH), { words, still });
  await page.context().close();
}

/** FRAMES=dir: a strip of frames across one loop of each hint, in each design, for review. */
async function frames(browser: Browser, dir: string) {
  mkdirSync(dir, { recursive: true });
  const variants: { name: string; layout: Layout; start: Start; loopMs: number }[] = [];
  for (const design of ['hand', 'finger', 'fingertip']) {
    variants.push(
      { name: `${design}-phone-both`, layout: 'phone', start: { dev: { force: 'doubleTake', design, input: 'touch' } }, loopMs: 3800 },
      { name: `${design}-desktop-both`, layout: 'desktop', start: { dev: { force: 'doubleTake', design } }, loopMs: 3800 },
      { name: `${design}-still`, layout: 'phone', start: { dev: { force: 'doubleTake', design, input: 'still' } }, loopMs: 0 },
    );
  }
  for (const v of variants) {
    const page = await open(browser, v.layout, v.start);
    await page.waitForSelector(HINT, { timeout: 8000 });
    await page.waitForTimeout(600);
    const box = (await page.locator(HINT).boundingBox())!;
    const pad = 12;
    const clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
    // Shoot as fast as the browser allows across one loop, then keep ten evenly spaced.
    const taken: { t: number; b64: string }[] = [];
    const t0 = Date.now();
    do taken.push({ t: Date.now() - t0, b64: (await page.screenshot({ clip })).toString('base64') });
    while (Date.now() - t0 < v.loopMs);
    const n = v.loopMs ? 10 : 1;
    const shots = Array.from({ length: n }, (_, i) => {
      const want = (i * v.loopMs) / n;
      return taken.reduce((a, b) => (Math.abs(b.t - want) < Math.abs(a.t - want) ? b : a)).b64;
    });
    const w = Math.ceil(clip.width);
    const h = Math.ceil(clip.height);
    const cols = Math.min(n, 5);
    const strip = await page.context().newPage();
    await strip.setViewportSize({ width: w * cols + 8 * (cols + 1), height: h * Math.ceil(n / 5) + 8 * (Math.ceil(n / 5) + 1) });
    await strip.setContent(
      `<body style="margin:0;padding:8px;background:#000;display:flex;flex-wrap:wrap;gap:8px">${shots
        .map((b) => `<img src="data:image/png;base64,${b}" style="width:${w}px;height:${h}px">`)
        .join('')}</body>`,
    );
    const out = join(dir, `${v.name}.png`);
    await strip.screenshot({ path: out, fullPage: true });
    console.log(`frames ${out}`);
    await page.context().close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
  if (process.env.FRAMES) await frames(browser, process.env.FRAMES);
  if (!process.env.FRAMES_ONLY) {
    await pixels(browser);
    if (!process.env.PIXELS_ONLY) {
      await phoneFlow(browser);
      await timesOut(browser);
      await desktopFlow(browser);
      await devPanel(browser);
      await fromHero(browser);
      await reducedMotion(browser);
    }
  }
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
