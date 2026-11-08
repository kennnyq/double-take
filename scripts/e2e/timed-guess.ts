/**
 * Browser check for the game, at phone size (touch) and desktop size.
 *
 * The Game tab: the untimed game in the feed (no countdown, no clock), marks
 * and skips counted live, more clips dealt as it goes, the answers reaching
 * Your skills (the Skills tab beside it).
 *
 * The timed round (the demo, from Dev settings → Game): countdown → mark (double tap / double click / A)
 * and skip (swipe / wheel / J) → a hidden tab freezes the clock → results →
 * every clip of the round shows, the wrong ones marked → a clip opens full
 * size with its explanation and closes back → Back to feed lands on the feed.
 * The app's rail (desktop) or tab bar (phone) stays throughout, and no poster
 * fails to load.
 *
 *   npm run e2e:game                                    (dev server on 8081)
 *   BASE_URL=http://localhost:8092 npm run e2e:game
 *
 * Plays a 20 s round (Dev settings → Game), so the dev server must be a dev build.
 * Needs a Chromium (see browser.ts).
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const GAME_DEV_KEY = 'double-take:game-dev:v1';

type Guess = { clipId: string; guess: 'ai' | 'real'; truth: 'ai' | 'real'; correct: boolean };
type Snapshot = { timed: boolean; reviewing?: boolean; inspecting?: boolean; intro?: boolean; phase: string; index: number; shown: number; busy: boolean; remainingMs: number; deadline: number | null; guesses: Guess[]; endReason: string | null; deck: { id: string; truth: string }[] };

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

/** Clicks the first element matching `sel` that's on screen (screens underneath keep hidden copies). */
async function clickVisible(page: Page, sel: string) {
  const i = await page.evaluate((s) => [...document.querySelectorAll(s)].findIndex((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !!(e as HTMLElement).offsetParent;
  }), sel);
  await page.locator(sel).nth(Math.max(0, i)).click();
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

/** The double take's hold: a held touch (phone) or held Space (desktop), longer than the hold delay. */
async function hold(page: Page, layout: Layout) {
  if (layout === 'desktop') {
    // Space belongs to the feed only while nothing else (a rail button) has the keyboard focus.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.down(' ');
    await page.waitForTimeout(1000);
    await page.keyboard.up(' ');
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const { x, y } = await stageCenter(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y + 120 }] });
  await page.waitForTimeout(1000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Back up to the clip before: the wheel (desktop) or a swipe down (phone). */
async function scrollBack(page: Page, layout: Layout) {
  if (layout === 'desktop') {
    await page.mouse.wheel(0, -240);
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const { x } = await stageCenter(page);
  const h = page.viewportSize()!.height;
  const from = Math.round(h * 0.15);
  const to = Math.round(h * 0.88);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }] });
  await touch('touchStart', from);
  for (let ty = from + 30; ty <= to; ty += 30) {
    await touch('touchMove', ty);
    await page.waitForTimeout(12);
  }
  await touch('touchEnd', to);
  await cdp.detach();
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
    localStorage.setItem(key, JSON.stringify({ roundMs: 20000 }));
  }, GAME_DEV_KEY);
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('video', { timeout: 90_000 });
  // The dev builds' design trial bar sits over the phone's tab bar.
  await page.addStyleTag({ content: '[data-trial-bar] { display: none !important; }' });

  const tab = (name: string) => (layout === 'desktop' ? `nav[aria-label="Main"] [aria-label="${name}"]` : `[role="tab"][aria-label="${name}"]`);
  await untimed(page, layout, tab);

  // The timed round is the demo: Dev settings → Game, not the app's own Settings.
  if (layout === 'desktop') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Settings"]');
    await page.waitForTimeout(500);
    check('Settings offers no timed round', (await page.getByText(/Timed guessing/).count()) === 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.keyboard.press('Control+.');
  await page.locator('[aria-label="Find a setting"]').fill('timed round');
  const launcher = page.getByText('Play the timed round', { exact: true }).first();
  await launcher.waitFor({ timeout: 10_000 });
  await launcher.click();
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
  // The feed's first-run gesture hint (it teaches the double take, which a round turns off) stays away.
  check('no gesture hint during the round', !(await hintShown(page)));
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

  // Skip, watching the timer every frame: moving between clips must not move it or change its time.
  const before = await game(page);
  await page.evaluate(() => {
    const w = window as unknown as { __timer: { x: number; y: number; deadline: number | null }[]; __timerOn: boolean };
    w.__timer = [];
    w.__timerOn = true;
    const tick = () => {
      const r = document.querySelector('[data-testid="game-timer"]')?.getBoundingClientRect();
      const g = (window as unknown as { __dtGame?: { deadline: number | null } }).__dtGame;
      if (r) w.__timer.push({ x: r.left, y: r.top, deadline: g?.deadline ?? null });
      if (w.__timerOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (layout === 'desktop') await page.mouse.wheel(0, 240);
  else await swipeUp(page);
  await waitFor(page, 'the skip advances', (s) => s.guesses.length === 2 && !s.busy);
  await page.waitForTimeout(600);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __timer: { x: number; y: number; deadline: number | null }[]; __timerOn: boolean };
    w.__timerOn = false;
    return w.__timer;
  });
  const drift = frames.length ? Math.max(...frames.map((f) => Math.hypot(f.x - frames[0].x, f.y - frames[0].y))) : -1;
  const deadlines = new Set(frames.map((f) => f.deadline).concat(before?.deadline ?? null));
  check('moving between clips leaves the timer where it is', frames.length > 10 && drift <= 1, { frames: frames.length, drift });
  check('moving between clips leaves the round’s time alone', deadlines.size === 1, [...deadlines]);
  // The hint comes back on every reel after a second until the double take is opened: still none in a round.
  await page.waitForTimeout(1600);
  check('no gesture hint on the next clip, a second and more in', !(await hintShown(page)));
  const afterSkip = await game(page);
  check(`${layout === 'desktop' ? 'wheel' : 'swipe up'} skips (counts as real)`, afterSkip?.guesses[1]?.guess === 'real', afterSkip?.guesses);

  if (layout === 'desktop') {
    await page.keyboard.press('a');
    await waitFor(page, 'A marks', (s) => s.guesses.length === 3 && !s.busy);
    await page.keyboard.press('j');
    await waitFor(page, 'J skips', (s) => s.guesses.length === 4 && !s.busy);
    const k = await game(page);
    check('A marks AI and J skips', k?.guesses[2]?.guess === 'ai' && k?.guesses[3]?.guess === 'real', k?.guesses);
    // Space works as it does on the feed, but for the round: one press does nothing (no pause),
    // a double press marks AI (the double take's gesture) instead of opening the double take.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(' ');
    await page.waitForTimeout(600);
    const one = await game(page);
    check('one press of Space does nothing', one?.guesses.length === 4 && one?.phase === 'playing', { guesses: one?.guesses.length, phase: one?.phase });
    await page.keyboard.press(' ');
    await page.waitForTimeout(90);
    await page.keyboard.press(' ');
    const two = await waitFor(page, 'double Space marks', (s) => s.guesses.length === 5 && !s.busy);
    const space = await page.evaluate(() => ({
      walkthrough: !!document.querySelector('[aria-label="Close the walkthrough"], [data-testid="dt-card"]'),
      pausedIcon: !!document.querySelector('.paused-icon'),
    }));
    check('a double press of Space marks AI', two?.guesses[4]?.guess === 'ai', two?.guesses.length);
    check('Space neither pauses the clip nor opens the double take in a round', !space.walkthrough && !space.pausedIcon, space);
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
  const over = await waitFor(page, 'time up', (s) => s.phase === 'over', 25_000);
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

  check('the results link to Your skills', (await page.getByRole('button', { name: 'Your skills', exact: true }).count()) > 0);
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

  // Skills is a tab of its own (the phone's tab bar, the desktop rail), and back out to Home the same way.
  await clickVisible(page, tab('Skills'));
  await page.waitForURL((u) => u.pathname === '/skills', { timeout: 10_000 }).catch(() => {});
  check('the Skills tab opens Your skills', new URL(page.url()).pathname === '/skills', page.url());
  await page.waitForTimeout(1500);
  const general = await page.locator('[data-testid="general-score"]').last().innerText().catch(() => '');
  check('Your skills shows a general score', /^\d+$/.test(general.trim()), general);
  check('the Skills tab shows as the current one', await anyVisible(page, layout === 'desktop' ? `${tab('Skills')}[aria-current="page"]` : `${tab('Skills')}[aria-selected="true"]`));
  await clickVisible(page, tab('Home'));
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10_000 }).catch(() => {});
  check('Home from the Skills tab lands on the feed', new URL(page.url()).pathname === '/' && !(await anyVisible(page, '.lt-hero')), page.url());
  await context.close();
}

/** Whether the feed's gesture hint is on screen. */
function hintShown(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="gesture-hint"]')].some((el) => {
      // The Game tab's intro draws the same hand; it isn't the feed's hint.
      if (el.closest('[data-testid="game-intro"]')) return false;
      let e: Element | null = el;
      let opacity = 1;
      while (e) {
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        opacity *= Number(st.opacity);
        e = e.parentElement;
      }
      const r = el.getBoundingClientRect();
      return opacity > 0.05 && r.width > 0 && r.height > 0;
    }),
  );
}

/** The Game tab: the untimed game, then its answers on the Skills tab beside it, and back to Home. */
async function untimed(page: Page, layout: Layout, tab: (name: string) => string) {
  const order = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getAttribute('aria-label')), layout === 'desktop' ? 'nav[aria-label="Main"] [aria-label]' : '[role="tab"][aria-label]');
  const names = order.filter((n): n is string => !!n && ['Home', 'Game', 'Skills', 'Upload', 'Profile', 'You', 'Settings'].includes(n));
  check('the tabs run Home, Game, Skills, Upload…', names.slice(0, 4).join() === 'Home,Game,Skills,Upload', names);
  await clickVisible(page, tab('Game'));
  await page.waitForURL((u) => u.pathname === '/play', { timeout: 10_000 }).catch(() => {});
  check('the Game tab opens the game', new URL(page.url()).pathname === '/play', page.url());
  const start = await waitFor(page, 'the game plays at once', (s) => s.timed === false && s.phase === 'playing', 30_000);
  check('the Game tab plays untimed, with no countdown', start?.timed === false && start.phase === 'playing', start && { timed: start.timed, phase: start.phase });
  await page.waitForTimeout(800);
  check('the Game tab shows as the current one', await anyVisible(page, layout === 'desktop' ? `${tab('Game')}[aria-current="page"]` : `${tab('Game')}[aria-selected="true"]`));
  check('no clock, Start or quit in the untimed game', !(await anyVisible(page, '[data-testid="game-timer"]')) && (await page.getByText('Start', { exact: true }).count()) === 0 && !(await anyVisible(page, '[aria-label="Quit round"]')));
  check('no verdict, double take or Auto label in the untimed game', (await leaks(page)).length === 0, await leaks(page));
  const chrome = layout === 'desktop' ? 'nav[aria-label="Main"]' : '[role="tab"][aria-label="Home"]';
  check(`the app's ${layout === 'desktop' ? 'rail' : 'tab bar'} stays in the Game tab`, await anyVisible(page, chrome));
  const introUp = await waitFor(page, 'the intro', (s) => s.intro === true, 5000);
  check('the Game tab opens with a short intro the first time', !!introUp && (await anyVisible(page, '[data-testid="game-intro"]')));

  // Watch the feed's scroll position through the mark's advance: it scrolls there, eased, never jumps.
  await page.evaluate((sel) => {
    const w = window as unknown as { __adv: number[]; __advOn: boolean };
    const el = [...document.querySelectorAll(sel)].find((e) => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 10) as HTMLElement | undefined;
    w.__adv = [];
    w.__advOn = true;
    const tick = () => {
      if (el) w.__adv.push(el.scrollTop);
      if (w.__advOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, layout === 'desktop' ? '.feed' : '[data-testid="clip-feed"], [data-testid="clip-feed"] *');
  await doubleTap(page, layout);
  const marked = await waitFor(page, 'the mark advances', (s) => s.guesses.length === 1 && !s.busy);
  check('Game tab: a double tap marks AI (the double take’s gesture)', marked?.guesses[0]?.guess === 'ai', marked?.guesses);
  await page.waitForTimeout(700);
  const adv = await page.evaluate(() => {
    const w = window as unknown as { __adv: number[]; __advOn: boolean };
    w.__advOn = false;
    return w.__adv;
  });
  const from = adv[0] ?? 0;
  const to = adv[adv.length - 1] ?? 0;
  const between = new Set(adv.filter((y) => y > from + 2 && y < to - 2).map((y) => Math.round(y))).size;
  check('marking AI scrolls on to the next clip (eased, not a jump)', to > from && between >= 3, { from, to, between });
  check('the first answer puts the intro away', marked?.intro === false);
  if (layout === 'desktop') await page.mouse.wheel(0, 240);
  else await swipeUp(page);
  const skipped = await waitFor(page, 'the skip advances', (s) => s.guesses.length === 2 && !s.busy);
  check('Game tab: a skip counts', skipped?.guesses[1]?.guess === 'real', skipped?.guesses);
  await page.waitForTimeout(1600);
  check('no gesture hint in the Game tab, a second and more on a clip', !(await hintShown(page)));
  const live = await page.locator('[data-testid="game-score-live"]').last().getAttribute('aria-label');
  check('the live score shows what was judged', /, 2 judged$/.test(live ?? ''), live);

  // A hold is the double take's gesture too (the setting is both by default): it marks AI, with nothing shown while it's held.
  const ringWhileHeld = page.evaluate(() => new Promise<boolean>((done) => setTimeout(() => done(!!document.querySelector('[data-testid="press-ring"]')), 450)));
  await hold(page, layout);
  check('nothing shows while a hold is pressed', !(await ringWhileHeld));
  const held = await waitFor(page, 'the hold marks', (s) => s.guesses.length === 3 && !s.busy);
  check(`Game tab: ${layout === 'desktop' ? 'holding Space' : 'a hold'} marks AI`, held?.guesses[2]?.guess === 'ai', held?.guesses);

  // Looking back at a judged clip: its answer shows, and its double take opens when it has one.
  await scrollBack(page, layout);
  const back = await waitFor(page, 'looking back', (s) => s.shown === s.index - 1 && !!s.reviewing, 8000);
  await page.waitForTimeout(1800);
  const look = await page.evaluate(() => ({
    pill: !!document.querySelector('[data-testid="review-truth"]'),
    walkthrough: !!document.querySelector('[aria-label="Close the walkthrough"]'),
  }));
  check('looking back at a judged clip shows its answer, or opens its double take', !!back && (look.pill || look.walkthrough), { back: back && { shown: back.shown, index: back.index }, ...look });
  if (look.walkthrough) {
    await page.click('[aria-label="Close the walkthrough"]');
    await page.waitForTimeout(1000);
  }
  if (layout === 'desktop') await page.mouse.wheel(0, 240);
  else await swipeUp(page);
  const resumed = await waitFor(page, 'back to the game', (s) => s.shown === s.index && !s.busy, 8000);
  check('moving on returns to the clip being judged, nothing judged on the way', resumed?.guesses.length === 3, resumed && { guesses: resumed.guesses.length, shown: resumed.shown, index: resumed.index });

  if (layout === 'desktop') {
    // Clip after clip: more are dealt before the deck runs out.
    const dealt = (await game(page))?.deck.length ?? 0;
    for (let i = 0; i < dealt; i++) {
      await page.keyboard.press('j');
      const n = 4 + i;
      await waitFor(page, `skip ${n}`, (s) => s.guesses.length === n && !s.busy, 8000);
    }
    const g = await game(page);
    check('the untimed game deals more clips as it goes', (g?.deck.length ?? 0) > dealt && g?.phase === 'playing', { before: dealt, now: g?.deck.length, phase: g?.phase });
  }

  await page.waitForTimeout(500);
  const skills = await page.evaluate(() => JSON.parse(localStorage.getItem('double-take.skills.v1') ?? '{}') as { overall?: { n?: number } });
  check('every answer reaches Your skills', (skills.overall?.n ?? 0) >= 2, skills.overall);
  await clickVisible(page, tab('Skills'));
  await page.waitForURL((u) => u.pathname === '/skills', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const general = await page.locator('[data-testid="general-score"]').last().innerText().catch(() => '');
  check('the Skills tab beside it shows the score', new URL(page.url()).pathname === '/skills' && /^\d+$/.test(general.trim()), { url: page.url(), general });
  await clickVisible(page, tab('Home'));
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  check('Home from the Game tab lands on the feed', new URL(page.url()).pathname === '/' && !(await anyVisible(page, '.lt-hero')), page.url());

  // Upload (the 'create' tab), beside the Game and Skills tabs, opens the upload modal: from Home, and from the Game screen.
  const create = page.getByText('Select from device', { exact: true });
  const modalUp = () => create.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const closeModal = async () => {
    await page.keyboard.press('Escape');
    await create.waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
      await clickVisible(page, '[aria-label="Close"]');
      await create.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    });
    await page.waitForTimeout(600);
  };
  await clickVisible(page, tab('Upload'));
  check('Upload opens the upload modal from Home', await modalUp());
  await closeModal();
  await clickVisible(page, tab('Game'));
  await page.waitForURL((u) => u.pathname === '/play', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await clickVisible(page, tab('Upload'));
  const fromGame = await modalUp();
  check('Upload opens the upload modal from the Game screen, over the feed', fromGame && new URL(page.url()).pathname === '/', page.url());
  await closeModal();
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
