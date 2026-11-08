/**
 * Browser check for the first-run gesture hint over the feed: one hint for
 * both ways into the double take (Both is the default), "Hold or double tap"
 * on phones and "Hold spacebar or double click" on desktop (a fine pointer). It goes as soon as either gesture opens a double take, comes
 * back on every signed-out reload; signed-in viewers remember half a second
 * of visibility. Quick scrolling retries on the next clip. Entering
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
  hints?: { seen: boolean };
  member?: boolean;
  dev?: { force?: string; design?: string; input?: string };
  reducedMotion?: boolean;
}

/** A fresh browser, storage seeded once (a reload keeps what the app saved since). */
async function open(browser: Browser, layout: Layout, start: Start = {}) {
  const context = await browser.newContext({ ...CONTEXT[layout], reducedMotion: start.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  // A local auth fixture exercises membership without creating an account.
  // Intercept its profile/social reads; no authenticated request leaves the browser.
  if (start.member) await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'hint-test@example.com', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' })).toString('base64url'), 'test-fixture'].join('.');
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
        'double-take-auth': start.member ? JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }) : '',
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

/** Signed-out refreshes always replay; opens are no longer lifetime progress. */
async function phoneFlow(browser: Browser) {
  const page = await open(browser, 'phone');
  check('phone, signed out: the gesture hint appears', (await hintWithin(page, 4000)) === PHONE_BOTH);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').seen === true, HINTS_KEY);
  check('phone: half a second fully visible is persisted', (await stored(page))?.seen === true);
  await openDoubleTake(page, 'phone');
  check('phone: opening a double take dismisses it', await hintGone(page, 2000));
  for (let i = 0; i < 2; i++) {
    await page.reload();
    check(`phone: signed-out refresh ${i + 1} replays even after seeing it`, (await hintWithin(page, 5000)) === PHONE_BOTH);
  }
  await page.context().close();
}

async function memberFlow(browser: Browser) {
  const page = await open(browser, 'desktop', { member: true });
  check('signed in, unseen: the hint appears', (await hintWithin(page, 5000)) === DESKTOP_BOTH);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').seen === true, HINTS_KEY);
  await page.reload();
  check('signed in: a seen prompt stays dismissed on refresh', (await hintWithin(page, 2500)) === null);
  await page.context().close();
}

async function quickScroll(browser: Browser) {
  const page = await open(browser, 'desktop', { member: true });
  const activeHint = `section.slide[aria-current="true"] ${HINT}`;
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector(activeHint, { timeout: 5000 });
    const active = await page.locator('section.slide[aria-current="true"]').evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
    // Move as soon as it starts to appear, before its 500 ms viewing window.
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((previous) => Array.from(document.querySelector('section.slide[aria-current="true"]')!.parentElement!.children).indexOf(document.querySelector('section.slide[aria-current="true"]')!) !== previous, active);
  }
  await page.waitForSelector(activeHint, { timeout: 5000 });
  check('four quick scrolls do not exhaust retries', (await page.getAttribute(activeHint, 'aria-label')) === DESKTOP_BOTH && (await stored(page))?.seen !== true);
  await page.reload();
  check('signed in: a brief glimpse does not suppress the prompt on refresh', (await hintWithin(page, 5000)) === DESKTOP_BOTH);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').seen === true, HINTS_KEY);
  await page.keyboard.press('ArrowDown');
  check('after being seen, it stays dismissed on the next reel', await hintGone(page, 2000));
  await page.reload();
  check('signed in: the viewing threshold also survives refresh', (await hintWithin(page, 2500)) === null);
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

/** Check rendered text geometry: an accessible label can be complete while its text is clipped. */
async function captionFits(page: Page, name: string) {
  const geometry = await page.locator(HINT).evaluate((el) => {
    const caption = el.lastElementChild as HTMLElement;
    const text = caption.getBoundingClientRect();
    const stage = el.getBoundingClientRect();
    return {
      clipped: caption.scrollWidth > caption.clientWidth,
      offset: text.x + text.width / 2 - (stage.x + stage.width / 2),
    };
  });
  check(`${name}: the full caption fits and is centered under the hand`, !geometry.clipped && Math.abs(geometry.offset) < 1, geometry);
}

/** Measure the loaded glyph's fingertip from its pixels, rather than its font box. */
async function handContact(browser: Browser) {
  for (const layout of ['desktop', 'phone'] as const) {
    const page = await open(browser, layout, { reducedMotion: true, dev: { force: 'doubleTake' } });
    await page.waitForSelector('[data-testid="gesture-hint-hand"] > *');
    await page.waitForTimeout(600);
    const offset = await page.evaluate(() => {
      const glyph = document.querySelector('[data-testid="gesture-hint-hand"]')!.firstElementChild!;
      const ring = document.querySelector('[data-testid="gesture-hint-ring"]')!.getBoundingClientRect();
      const box = glyph.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.font = `512px ${getComputedStyle(glyph).fontFamily}`;
      const text = glyph.textContent!;
      ctx.fillText(text, 0, ctx.measureText(text).fontBoundingBoxAscent);
      const pixels = ctx.getImageData(0, 0, 512, 512).data;
      const row = (y: number) => {
        const xs = [];
        for (let x = 0; x < 512; x++) if (pixels[(y * 512 + x) * 4 + 3] >= 128) xs.push(x);
        return xs;
      };
      let top = 0;
      while (top < 512 && row(top).length === 0) top++;
      // Just below the rounded cap, the upright finger has its full width.
      const finger = row(top + 32);
      const left = finger[0];
      const right = finger.at(-1)! + 1;
      return {
        x: box.x + box.width * (left + right) / 2 / 512 - (ring.x + ring.width / 2),
        y: box.y + box.height * (top + (right - left) / 2) / 512 - (ring.y + ring.height / 2),
      };
    });
    check(`${layout}: the fingertip is centered in the hold circle`, Math.abs(offset.x) < 1 && Math.abs(offset.y) < 1, offset);
    await page.context().close();
  }
}

/** Is it seen, over the video: desktop (direct, from the hero, with the dev panel open) and phone. */
async function pixels(browser: Browser) {
  for (const layout of ['desktop', 'phone'] as const) {
    const page = await open(browser, layout);
    const words = await hintWithin(page, 4000);
    await page.waitForTimeout(800);
    await captionFits(page, layout);
    const seen = await hintPainted(page);
    check(`${layout}: the hint is painted over the video, not under it`, words !== null && seen === true, { words, seen });
    if (layout === 'desktop') {
      await page.setViewportSize({ width: 800, height: 500 });
      await page.waitForTimeout(450);
      await captionFits(page, 'compact desktop');
    }
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
  const page = await open(browser, 'desktop', { hints: { seen: true }, member: true });
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
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      // A previous visit must not suppress entry from the hero while signed out.
      localStorage.setItem(key, JSON.stringify({ seen: true }));
    }, HINTS_KEY);
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
    await handContact(browser);
    if (!process.env.PIXELS_ONLY) {
      await phoneFlow(browser);
      await memberFlow(browser);
      await quickScroll(browser);
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
