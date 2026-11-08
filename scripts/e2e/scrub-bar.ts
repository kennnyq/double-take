/**
 * Browser check for the clip's progress bar, desktop and phone layouts:
 * hovering (desktop) thickens it; a click or tap fast-forwards or rewinds
 * there through several frames (never a jump); dragging along it moves the
 * video with the pointer, paused, and playback resumes after; arrow keys seek
 * (desktop); a drag on the bar doesn't scroll the feed; during a double take
 * it stays, dimmed, and ignores the pointer.
 *
 *   npm run e2e:scrub                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8089 npm run e2e:scrub
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

type Layout = 'desktop' | 'phone';

async function open(browser: Browser, layout: Layout) {
  const context = await browser.newContext(
    layout === 'desktop' ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __t: { at: number; t: number; paused: boolean }[]; __v: HTMLVideoElement | null };
    w.__t = [];
    w.__v = null;
    const tick = () => {
      if (w.__v) w.__t.push({ at: performance.now(), t: w.__v.currentTime, paused: w.__v.paused });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  // Watch the playing video.
  await page.evaluate(() => {
    const w = window as unknown as { __v: HTMLVideoElement | null };
    w.__v = [...document.querySelectorAll('video')].find((v) => !v.paused && v.duration > 0) ?? null;
  });
  return page;
}

/** The bar's strip on the active clip, in page coordinates. */
async function bar(page: Page, layout: Layout) {
  return page.evaluate((l) => {
    if (l === 'desktop') {
      const r = document.querySelector('section.slide[aria-current="true"] .d-scrub')!.getBoundingClientRect();
      return { x: r.x, y: r.y + r.height - 6, w: r.width };
    }
    // Phone: the video's bottom edge; the bar's strip is the bottom 28 px of it.
    const v = (window as unknown as { __v: HTMLVideoElement }).__v.getBoundingClientRect();
    const stage = [...document.querySelectorAll('[aria-label="Pause"], [aria-label="Play"]')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.top > -5 && r.top < 60 && r.height > 300;
    })!.getBoundingClientRect();
    return { x: stage.x, y: stage.y + stage.height - 8, w: stage.width, v: v.height };
  }, layout);
}

const samples = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __t: { at: number; t: number; paused: boolean }[] };
    const out = w.__t;
    w.__t = [];
    return out;
  });
const duration = (page: Page) => page.evaluate(() => (window as unknown as { __v: HTMLVideoElement }).__v.duration);

/** A run to `target` through several frames, ending near it, with no single frame jumping more than `maxStep`. */
function eased(s: { t: number }[], target: number, maxStep = 1.2) {
  const distinct = new Set(s.map((x) => x.t.toFixed(2))).size;
  let biggest = 0;
  for (let i = 1; i < s.length; i++) biggest = Math.max(biggest, Math.abs(s[i].t - s[i - 1].t));
  const end = s[s.length - 1]?.t ?? NaN;
  return { ok: distinct >= 5 && biggest <= maxStep && Math.abs(end - target) < 0.6, distinct, biggest: +biggest.toFixed(2), end: +end.toFixed(2), target: +target.toFixed(2) };
}

async function desktop(browser: Browser) {
  const page = await open(browser, 'desktop');
  const d = await duration(page);
  const b = await bar(page, 'desktop');

  await page.mouse.move(b.x + b.w * 0.5, b.y);
  await page.waitForTimeout(350);
  const hover = await page.evaluate(() => {
    const s = document.querySelector('section.slide[aria-current="true"] .d-scrub')!;
    return { track: getComputedStyle(s.querySelector('.d-scrub-track')!).transform, bubble: getComputedStyle(s.querySelector('.d-scrub-bubble')!).opacity };
  });
  check('desktop: hovering thickens the bar and shows the time', hover.track.includes('2') && hover.bubble === '1', hover);

  await samples(page);
  await page.mouse.click(b.x + b.w * 0.8, b.y);
  await page.waitForTimeout(1300);
  const click = eased(await samples(page), d * 0.8);
  check('desktop: a click runs the video there (eased)', click.ok, click);

  // Drag from 20% to 60%: the video follows the pointer, paused, and plays after.
  await page.mouse.move(b.x + b.w * 0.2, b.y);
  await page.mouse.down();
  const follow: { want: number; got: number; paused: boolean }[] = [];
  for (let k = 1; k <= 8; k++) {
    const f = 0.2 + (0.4 * k) / 8;
    await page.mouse.move(b.x + b.w * f, b.y, { steps: 2 });
    await page.waitForTimeout(80);
    const v = await page.evaluate(() => {
      const el = (window as unknown as { __v: HTMLVideoElement }).__v;
      return { t: el.currentTime, paused: el.paused };
    });
    follow.push({ want: +(f * d).toFixed(2), got: +v.t.toFixed(2), paused: v.paused });
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const resumed = await page.evaluate(() => !(window as unknown as { __v: HTMLVideoElement }).__v.paused);
  check('desktop: dragging moves the video with the pointer, paused', follow.every((x) => Math.abs(x.want - x.got) < 0.5 && x.paused), follow);
  check('desktop: playback resumes after the drag', resumed, { resumed });

  // Arrow keys: 5 s on, then back, each as a run.
  await page.mouse.move(10, 400);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => (window as unknown as { __v: HTMLVideoElement }).__v.currentTime);
  await samples(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  const right = eased(await samples(page), Math.min(d - 0.25, before + 5), 1.2);
  check('desktop: ArrowRight runs 5 s on', right.ok || Math.abs(right.end - Math.min(d - 0.25, before + 5)) < 0.8, right);

  // During a double take the bar stays, dimmed, and ignores the pointer.
  await page.click('section.slide[aria-current="true"] [aria-label^="Double take"]');
  await page.waitForTimeout(1500);
  const faded = await page.evaluate(() => {
    const s = document.querySelector('section.slide[aria-current="true"] .d-scrub')!;
    const c = getComputedStyle(s);
    return { opacity: c.opacity, events: c.pointerEvents };
  });
  check('desktop: the bar stays dimmed and out of reach during a double take', faded.opacity === '0.4' && faded.events === 'none', faded);
  await page.context().close();
}

async function phone(browser: Browser) {
  const page = await open(browser, 'phone');
  const d = await duration(page);
  const b = await bar(page, 'phone');
  const scrollBefore = await page.evaluate(() =>
    [...document.querySelectorAll('div')].map((e) => e.scrollTop).reduce((a, x) => a + x, 0),
  );

  await samples(page);
  await page.touchscreen.tap(b.x + b.w * 0.75, b.y);
  await page.waitForTimeout(1300);
  const tap = eased(await samples(page), d * 0.75);
  check('phone: a tap on the bar runs the video there (eased)', tap.ok, tap);

  // A sideways drag with real touch events: the video follows the finger and the feed stays put.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: b.y }] });
  await touch('touchStart', b.x + b.w * 0.2);
  const follow: { want: number; got: number }[] = [];
  for (let k = 1; k <= 8; k++) {
    const f = 0.2 + (0.4 * k) / 8;
    await touch('touchMove', b.x + b.w * f);
    await page.waitForTimeout(80);
    const got = await page.evaluate(() => (window as unknown as { __v: HTMLVideoElement }).__v.currentTime);
    follow.push({ want: +(f * d).toFixed(2), got: +got.toFixed(2) });
  }
  await touch('touchEnd', b.x + b.w * 0.6);
  await page.waitForTimeout(600);
  const scrollAfter = await page.evaluate(() =>
    [...document.querySelectorAll('div')].map((e) => e.scrollTop).reduce((a, x) => a + x, 0),
  );
  // The first move only decides it's a drag; from then on the video follows.
  check('phone: dragging along the bar moves the video with the finger', follow.slice(1).every((x) => Math.abs(x.want - x.got) < 0.6), follow);
  check('phone: a drag on the bar doesn’t scroll the feed', scrollAfter === scrollBefore, { scrollBefore, scrollAfter });
  await page.context().close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
  await desktop(browser);
  await phone(browser);
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
