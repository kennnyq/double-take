/**
 * Browser check for the desktop feed's Space key, with real (trusted) key
 * events in Chromium: held Space opens the double take, a quick press
 * plays/pauses the clip (or, during a double take, goes on to its next step), and
 * none of it depends on what was clicked last. It caught the
 * bug where a clicked button (e.g. Unmute) kept focus and took Space.
 *
 *   npm run e2e:space                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8086 npm run e2e:space
 *
 * Needs a running dev server (it is not part of `npm run check`) and a Chromium:
 * CHROME_PATH, else any Playwright Chromium in ~/.cache/ms-playwright, else
 * Playwright's own (`npx playwright-core install chromium`). Signs in as the
 * dev test account `alice` when `npm run dev:auth` is up; skips that otherwise.
 */
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';

const HOLD_MS = 700; // past the longest hold length (500 ms)

const ACTIVE = 'section.slide[aria-current="true"]';
const CLOSE_WALKTHROUGH = '[aria-label="Close the walkthrough"]';

async function state(page: Page) {
  return page.evaluate(
    ([active, close]) => ({
      open: !!document.querySelector(close),
      paused: !!document.querySelector(`${active} .paused-icon`),
      // The mute button hides during the walkthrough: null then.
      muted: (() => {
        const label = document.querySelector(`${active} .mute-btn`)?.getAttribute('aria-label');
        return label ? label === 'Unmute' : null;
      })(),
      clip: [...document.querySelectorAll('section.slide')].findIndex((s) => s.getAttribute('aria-current') === 'true'),
      scrollY: window.scrollY,
    }),
    [ACTIVE, CLOSE_WALKTHROUGH],
  );
}

/** Hold Space like a person: one press, auto-repeats, then the release. */
async function holdSpace(page: Page) {
  await page.keyboard.down(' ');
  for (let t = 0; t < HOLD_MS; t += 50) {
    await page.waitForTimeout(50);
    await page.keyboard.down(' '); // repeat
  }
  await page.keyboard.up(' ');
  await page.waitForTimeout(1200); // the tells file loads
}

async function closeWalkthrough(page: Page) {
  if ((await state(page)).open) await page.click(CLOSE_WALKTHROUGH);
  await page.waitForTimeout(400);
  if ((await state(page)).paused) await page.click(`${ACTIVE} .tap-layer`);
  await page.waitForTimeout(400);
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

/** After `setup`, a held Space opens the double take and changes nothing else. */
async function holdOpens(page: Page, name: string, setup: () => Promise<void>, { sameSound = true } = {}) {
  await setup();
  await page.waitForTimeout(400);
  const before = await state(page);
  await holdSpace(page);
  const after = await state(page);
  const focus = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
  await closeWalkthrough(page);
  const closed = await state(page);
  check(
    `hold Space ${name}`,
    after.open && !after.paused && after.clip === before.clip && after.scrollY === 0 && (!sameSound || closed.muted === before.muted),
    { before, after, closed, focus },
  );
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await cacheFeed(page);
  await page.addInitScript(() => localStorage.clear()); // default settings: Hold
  await page.goto(`${BASE_URL}/#app`);
  // The first clip with tells has a Double take button.
  await page.waitForSelector(`${ACTIVE} .d-actions button[aria-label^="Double take"]`, { timeout: 90_000 });
  await page.waitForTimeout(1500);

  await holdOpens(page, 'on a fresh load', async () => {});

  // During a double take, a new press goes on to the next step (on this
  // one-tell clip: finishes it), without pausing; the hold that opened it
  // didn't advance it.
  await holdSpace(page);
  const openedOnFirst = await page.evaluate(() => ({
    open: !!document.querySelector('[aria-label="Close the walkthrough"]'),
    scrubs: ((window as unknown as { __dtMarks?: { kind: string }[] }).__dtMarks ?? []).filter((m) => m.kind === 'scrubStart').length,
  }));
  await page.waitForTimeout(800);
  await page.keyboard.press(' ');
  await page.waitForTimeout(700);
  const afterPress = await state(page);
  check(
    'Space during a double take goes on to its next step, not pause',
    openedOnFirst.open && !afterPress.open && !afterPress.paused,
    { openedOnFirst, afterPress },
  );
  await closeWalkthrough(page);

  // Standalone Space toggles playback after the shared double-tap window,
  // with the existing pause visual, and never changes clips.
  const beforeSingle = await state(page);
  await page.keyboard.press(' ');
  await page.waitForTimeout(600);
  const paused = await state(page);
  check('a quick Space pauses the current clip', paused.paused && paused.clip === beforeSingle.clip && !paused.open, paused);
  await page.keyboard.press(' ');
  await page.waitForTimeout(600);
  const playing = await state(page);
  check('a second isolated Space resumes the same clip', !playing.paused && playing.clip === beforeSingle.clip && !playing.open, playing);

  await holdOpens(page, 'after clicking Unmute (the reported bug)', () => page.click(`${ACTIVE} .mute-btn`));
  await holdOpens(page, 'after clicking the video twice', async () => {
    await page.click(`${ACTIVE} .tap-layer`);
    await page.waitForTimeout(500);
    await page.click(`${ACTIVE} .tap-layer`);
  });
  await holdOpens(page, 'after clicking the rail', () => page.click('nav [aria-label="Home"]'));
  await holdOpens(page, 'after the Double take button', async () => {
    await page.click(`${ACTIVE} .d-actions button[aria-label^="Double take"]`);
    await page.waitForSelector(CLOSE_WALKTHROUGH);
    await page.click(CLOSE_WALKTHROUGH);
  });
  await holdOpens(page, 'after opening and closing Settings', async () => {
    await page.click('nav [aria-label="Settings"]');
    await page.waitForSelector('[aria-modal="true"]');
    // Space inside the dialog is the dialog's.
    await holdSpace(page);
    check('Space inside Settings does not open the double take', !(await state(page)).open, await state(page));
    await page.click('[aria-modal="true"] [aria-label="Close"]');
  });

  await holdOpens(page, 'after opening and closing the comments', async () => {
    await page.click(`${ACTIVE} .d-actions button[aria-label^="Comments"]`);
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  });

  // A control reached with the keyboard keeps Space: Tab away from the mute
  // button and back, then Space presses it (mute toggles) and opens nothing.
  await page.click(`${ACTIVE} .mute-btn`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const tabbed = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const mutedBefore = (await state(page)).muted;
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  const s = await state(page);
  check('Space on a control reached with Tab presses it', !s.open && s.muted === !mutedBefore, { tabbed, mutedBefore, s });
  await closeWalkthrough(page);

  // Gesture settings, fast taps, repeats, and editable ownership.
  for (const mode of ['hold', 'doubleTap', 'both']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem('double-take.settings.v1', JSON.stringify({ revealGesture: mode }));
    }, mode);
    await p.goto(BASE_URL + '/#app');
    await p.waitForSelector(ACTIVE + ' .double-take', { timeout: 90000 });
    await p.waitForTimeout(700);
    await p.keyboard.press(' ');
    await p.waitForTimeout(80);
    if (mode !== 'hold') check(mode + ': first Space neither pauses nor advances early', (await state(p)).clip === 0 && !(await state(p)).paused, await state(p));
    await p.keyboard.press(' ');
    await p.waitForTimeout(1400);
    check(mode + ': double Space obeys the setting', mode === 'hold' ? !(await state(p)).open : (await state(p)).open && (await state(p)).clip === 0 && !(await state(p)).paused, await state(p));
    await closeWalkthrough(p);
    // Test input/textarea/contenteditable, covering link fields, comments and notes.
    for (const tag of ['input', 'textarea', 'div']) {
      await p.evaluate(tag => {
        const el = document.createElement(tag);
        el.id = 'typing-space-test';
        if (tag === 'div') el.contentEditable = 'true';
        el.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:white';
        document.body.append(el);
        el.focus();
      }, tag);
      const before = await state(p);
      await p.keyboard.press(' '); await p.waitForTimeout(60); await p.keyboard.press(' ');
      await p.waitForTimeout(350);
      const value = await p.locator('#typing-space-test').evaluate(el => 'value' in el ? (el as HTMLInputElement).value : el.textContent);
      check(mode + ': double Space types in ' + tag, value?.replace(/\u00a0/g, ' ') === '  ' && (await state(p)).clip === before.clip && !(await state(p)).open, { value, state: await state(p) });
      await p.locator('#typing-space-test').evaluate(el => el.remove());
    }
    await ctx.close();
  }

  // Signed in (dev test account), when the dev auth server is up.
  await page.click(`${ACTIVE} .d-actions button[aria-label^="Like"]`);
  const signIn = await page.waitForSelector('[aria-label="Sign in as alice"]', { timeout: 5000 }).catch(() => null);
  if (signIn) {
    await signIn.click();
    await page.waitForSelector('[aria-label="Sign in"]', { state: 'detached', timeout: 15_000 }).catch(() => {});
    await holdOpens(page, 'signed in as alice', async () => {});
  } else {
    console.log('skip signed-in check (no dev auth, or already signed in)');
    await page.keyboard.press('Escape');
  }

  // The landing's launch: press its call to action and let the clip grow into the feed.
  const landing = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await landing.addInitScript(() => localStorage.clear());
  await landing.goto(`${BASE_URL}/`);
  await landing.click('.lt-cta', { timeout: 60_000 });
  await landing.waitForSelector(`${ACTIVE} .d-actions button[aria-label^="Double take"]`, { timeout: 60_000 });
  await landing.waitForTimeout(2500);
  // The landing hands its sound over to the feed on its own schedule, so sound isn't compared here.
  await holdOpens(landing, 'after the landing’s launch into the feed', async () => {}, { sameSound: false });

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
