/**
 * Browser check for the timed round, at phone size (touch) and desktop size:
 * Settings → Timed guessing → countdown → mark (double tap / double click / A)
 * and skip (swipe / wheel / J) → a hidden tab freezes the clock → results →
 * every clip of the round shows, the wrong ones marked → a clip opens full
 * size with its explanation and closes back → Back to feed lands on the feed.
 * The app's rail (desktop) or tab bar (phone) stays throughout, and no poster
 * fails to load.
 *
 *   npm run e2e:game                                    (dev server on 8081)
 *   BASE_URL=http://localhost:8092 npm run e2e:game
 *
 * Plays an 8 s round (Dev settings → Game), so the dev server must be a dev build.
 * Needs a Chromium (see browser.ts).
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const GAME_DEV_KEY = 'double-take:game-dev:v1';

type Guess = { clipId: string; guess: 'ai' | 'real'; truth: 'ai' | 'real'; correct: boolean };
type Snapshot = { phase: string; index: number; shown: number; busy: boolean; remainingMs: number; guesses: Guess[]; endReason: string | null; deck: { id: string; truth: string }[] };

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

type Layout = 'desktop' | 'phone';

const game = (page: Page) => page.evaluate(() => (window as unknown as { __dtGame?: Snapshot }).__dtGame ?? null);

async function waitFor(page: Page, what: string, fn: (s: Snapshot) => boolean, timeout = 15_000): Promise<Snapshot | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await game(page);
    if (s && fn(s)) return s;
    await page.waitForTimeout(100);
  }
  check(`wait: ${what}`, false, await game(page));
  return null;
}

/** Elements that would give the answer away, visible anywhere on the page. */
async function leaks(page: Page) {
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && Number(st.opacity) > 0;
    };
    const sel = ['[aria-label^="Verdict:"]', '[aria-label^="Double take"]'];
    const found = sel.flatMap((s) => [...document.querySelectorAll(s)].filter(visible).map(() => s));
    const text = [...document.querySelectorAll('div, span')].filter((e) => e.childElementCount === 0 && /^(Auto label|Not AI)$/.test(e.textContent ?? '') && visible(e));
    return [...found, ...text.map((e) => e.textContent)];
  });
}

/** Images inside `within` that failed to load (a 404 poster would leave a black card). */
async function brokenImages(page: Page, within: string) {
  return page.evaluate(
    (sel) => [...document.querySelectorAll(`${sel} img`)].filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0 && (i as HTMLImageElement).src.startsWith('http')).length,
    within,
  );
}

/** Whether any element matching `sel` is on screen (the Home screen's own copy stays mounted, hidden, underneath). */
async function anyVisible(page: Page, sel: string) {
  return page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && e.closest('[aria-hidden="true"]') === null && !!(e as HTMLElement).offsetParent;
  }), sel);
}

/** The middle of the round's stage. */
async function stageCenter(page: Page) {
  const vp = page.viewportSize()!;
  return { x: vp.width / 2, y: vp.height / 2 };
}

async function swipeUp(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { x } = await stageCenter(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }] });
  // Most of a page, as a real swipe: the feed's paging snaps back from anything under half.
  const h = page.viewportSize()!.height;
  const from = Math.round(h * 0.85);
  const to = Math.round(h * 0.12);
  await touch('touchStart', from);
  for (let ty = from - 30; ty >= to; ty -= 30) {
    await touch('touchMove', ty);
    await page.waitForTimeout(12);
  }
  await touch('touchEnd', to);
  await cdp.detach();
}

async function doubleTap(page: Page, layout: Layout) {
  const { x, y } = await stageCenter(page);
  if (layout === 'desktop') await page.mouse.dblclick(x, y);
  else {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(x, y);
  }
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function run(browser: Browser, layout: Layout) {
  console.log(`\n# ${layout}`);
  const context = await browser.newContext(
    layout === 'desktop'
      ? { viewport: { width: 1280, height: 800 } }
      : { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => check(`no page error (${e.message.slice(0, 80)})`, false));
  await page.addInitScript((key) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify({ roundMs: 8000 }));
  }, GAME_DEV_KEY);
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('video', { timeout: 90_000 });
  // The dev builds' design trial bar sits over the phone's tab bar.
  await page.addStyleTag({ content: '[data-trial-bar] { display: none !important; }' });

  // Settings → Timed guessing.
  if (layout === 'desktop') await page.click('[aria-label="Settings"]');
  else await page.click('[role="tab"][aria-label="Settings"]');
  const row = page.locator('[aria-label^="Timed guessing"]').first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.getByText('Start', { exact: true }).waitFor({ timeout: 30_000 });
  check('the round opens on /game', new URL(page.url()).pathname === '/game', page.url());
  await page.waitForTimeout(400);
  await page.getByText('Start', { exact: true }).click();
  const countdown = await game(page);
  check('Start counts down', countdown?.phase === 'countdown', countdown?.phase);
  await waitFor(page, 'playing', (s) => s.phase === 'playing');
  await page.waitForTimeout(300);
  check('no verdict, double take or Auto label while playing', (await leaks(page)).length === 0, await leaks(page));
  // The feed's chrome is there (caption, author, rail) but locked, and says nothing about the answer.
  const stageText = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="game-stage"]') as HTMLElement | null;
    if (!stage) return '';
    const clone = stage.cloneNode(true) as HTMLElement;
    // The round's own overlay (clock, instructions, stamp) isn't the clip's.
    clone.querySelectorAll('[data-testid="mark-stamp"], [data-testid="round-overlay"]').forEach((n) => n.remove());
    return clone.innerText;
  });
  check('the clips show the feed’s author and buttons', /Subscribe|Follow/.test(stageText), stageText.slice(0, 80));
  check('nothing on the clips names AI or real', !/\b(ai|a\.i\.|real|generated|fake|sora|veo|deepfake|verdict)\b/i.test(stageText), stageText.match(/.{0,30}\b(ai|real|generated|fake|sora|veo|deepfake|verdict)\b.{0,30}/i)?.[0]);
  const locked = await page.evaluate(() => {
    const like = [...document.querySelectorAll('[data-testid="game-stage"] [aria-label^="Like"]')][0] as HTMLElement | undefined;
    if (!like) return null;
    let e: HTMLElement | null = like;
    let opacity = 1;
    let off = false;
    while (e) {
      const st = getComputedStyle(e);
      opacity *= Number(st.opacity);
      if (st.pointerEvents === 'none') off = true;
      e = e.parentElement;
    }
    return { opacity, off };
  });
  check('the clip’s buttons are dimmed and out of reach', !!locked && locked.opacity < 0.6 && locked.off, locked);
  const chrome = layout === 'desktop' ? 'nav[aria-label="Main"]' : '[role="tab"][aria-label="Home"]';
  check(`the app's ${layout === 'desktop' ? 'rail' : 'tab bar'} stays during the round`, await anyVisible(page, chrome));
  check('the clip on screen and the next one load (no broken posters)', (await brokenImages(page, '[data-testid="game-stage"]')) === 0, await brokenImages(page, '[data-testid="game-stage"]'));
  const playingVideos = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length);
  check('only the round plays (the feed underneath is paused)', playingVideos <= 1, playingVideos);

  // Mark AI.
  await doubleTap(page, layout);
  await waitFor(page, 'the mark advances', (s) => s.guesses.length === 1 && s.shown === 1 && !s.busy);
  const afterMark = await game(page);
  check(`${layout === 'desktop' ? 'double click' : 'double tap'} marks AI`, afterMark?.guesses[0]?.guess === 'ai', afterMark?.guesses);

  // Skip.
  if (layout === 'desktop') await page.mouse.wheel(0, 240);
  else await swipeUp(page);
  await waitFor(page, 'the skip advances', (s) => s.guesses.length === 2 && !s.busy);
  const afterSkip = await game(page);
  check(`${layout === 'desktop' ? 'wheel' : 'swipe up'} skips (counts as real)`, afterSkip?.guesses[1]?.guess === 'real', afterSkip?.guesses);

  if (layout === 'desktop') {
    await page.keyboard.press('a');
    await waitFor(page, 'A marks', (s) => s.guesses.length === 3 && !s.busy);
    await page.keyboard.press('j');
    await waitFor(page, 'J skips', (s) => s.guesses.length === 4 && !s.busy);
    const k = await game(page);
    check('A marks AI and J skips', k?.guesses[2]?.guess === 'ai' && k?.guesses[3]?.guess === 'real', k?.guesses);
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
    check('Space does nothing', (await game(page))?.guesses.length === 4);
  }

  // A hidden tab freezes the clock.
  await setHidden(page, true);
  const p1 = await waitFor(page, 'paused', (s) => s.phase === 'paused');
  await page.waitForTimeout(1500);
  const p2 = await game(page);
  check('hidden: paused, clock frozen', p1?.remainingMs === p2?.remainingMs && p2?.phase === 'paused', { p1: p1?.remainingMs, p2: p2?.remainingMs });
  await setHidden(page, false);
  await page.getByText('Resume', { exact: true }).click();
  await waitFor(page, 'playing again', (s) => s.phase === 'playing');

  // Let time run out.
  const over = await waitFor(page, 'time up', (s) => s.phase === 'over', 15_000);
  check('the round ends on time', over?.endReason === 'time', over?.endReason);
  await page.waitForURL((u) => u.pathname === '/game/results', { timeout: 10_000 }).catch(() => {});
  check('results open', new URL(page.url()).pathname === '/game/results', page.url());
  await page.waitForSelector('[data-testid="game-score"]', { timeout: 10_000 });
  await page.waitForTimeout(1200);

  // Let the reveal finish (tiles turn, the score lands).
  await page.waitForTimeout(4500);
  const guesses = over?.guesses ?? [];
  const wrong = guesses.filter((g) => !g.correct).length;
  const shownClips = guesses.length + (over?.endReason === 'time' && over.index < over.deck.length ? 1 : 0);
  const tiles = await page.locator('[data-testid="result-tile"]').count();
  check('the results show every clip of the round', tiles === shownClips, { tiles, shownClips });
  const wrongTiles = await page.locator('[data-testid="result-tile"][aria-label^="Wrong"]').count();
  check('each wrong guess is marked wrong (✕ and colour)', wrongTiles === wrong, { wrongTiles, wrong });
  const expected = Math.max(0, guesses.reduce((n, g) => n + (g.guess === 'ai' ? (g.truth === 'ai' ? 1 : -1) : 0), 0));
  const score = Number(await page.locator('[data-testid="game-score"]').innerText());
  check('the score counts up to the guesses’ score', score === expected, { score, expected });
  const skillCard = await page.waitForSelector('[data-testid="skill-bars"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  check('the results show how the round moved your skills', skillCard);
  check('posters loaded on the results (no black tiles)', (await brokenImages(page, '[data-testid="result-tile"]')) === 0, await brokenImages(page, '[data-testid="result-tile"]'));

  if (tiles > 0) {
    await page.locator('[data-testid="result-tile"]').first().click();
    await page.waitForSelector('[data-testid="clip-expanded"]', { timeout: 10_000 });
    // A clip with tells opens the double take's walkthrough first; its Close (or last step) leads to the why card.
    const first = await Promise.race([
      page.waitForSelector('[aria-label="Close the walkthrough"]', { timeout: 15_000 }).then(() => 'walk'),
      page.waitForSelector('[data-testid="miss-explanation"]', { timeout: 15_000 }).then(() => 'why'),
    ]).catch(() => 'none');
    check('the opened clip explains itself (walkthrough or why card)', first !== 'none', first);
    if (first === 'walk') {
      await page.waitForTimeout(800);
      await page.click('[aria-label="Close the walkthrough"]');
    }
    const card = page.locator('[data-testid="miss-explanation"]');
    await card.waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(900);
    check('it ends on why it was AI or real', /Why it was (AI|real)/.test((await card.getAttribute('aria-label')) ?? ''), await card.getAttribute('aria-label').catch(() => null));
    await page.click('[data-testid="clip-expanded"] [aria-label="Close"]');
    await page.waitForSelector('[data-testid="clip-expanded"]', { state: 'detached', timeout: 10_000 });
    check('it closes back into the grid', true);
  }

  await page.getByRole('button', { name: 'Your skills', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/game/skills', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="skill-bars"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // The results' own copy stays mounted underneath: the skills view's is the last.
  const general = await page.locator('[data-testid="general-score"]').last().innerText().catch(() => '');
  check('Your skills shows a general score', /^\d+$/.test(general.trim()), general);
  // The app's own back (a browser Back drops #app and brings the landing page up).
  await page.locator('[aria-label="Back"]').last().click();
  await page.waitForURL((u) => u.pathname === '/game/results', { timeout: 10_000 }).catch(() => {});
  await page.getByText('Back to feed', { exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10_000 }).catch(() => {});
  check('Back to feed lands on /', new URL(page.url()).pathname === '/', page.url());
  await page.waitForTimeout(1500);
  // Headless Chromium has no H.264, so "playing" is only checked where the browser can decode the clips.
  const h264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
  if (h264) {
    const playing = await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused));
    check('the feed plays again', playing);
  } else {
    const feed = await page.locator(layout === 'desktop' ? 'section.slide[aria-current="true"]' : '[role="tab"][aria-label="Home"]').count();
    check('the feed is back (this browser cannot decode H.264: playback not checked)', feed > 0);
  }
  await context.close();
}

const browser = await chromium.launch({ executablePath: findChrome() });
try {
  await run(browser, 'phone');
  await run(browser, 'desktop');
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
