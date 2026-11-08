/**
 * Browser smoke test for the game lab (/dev/game-lab, dev builds): every
 * design of every element of the timed round renders and runs its fake
 * state without a page error, and the lab's picks reach Dev settings' store.
 *
 *   npm run e2e:lab                                    (dev server on 8081)
 *   BASE_URL=http://localhost:8092 npm run e2e:lab
 *   SHOTS=/abs/dir npm run e2e:lab    also records each design and saves a frame strip
 *                                     of its motion (needs ffmpeg; STRIPS=hud,expand for some)
 *
 * Needs a running dev server and a Chromium (see browser.ts).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const SHOTS = process.env.SHOTS;
const DESIGNS: Record<string, string[]> = {
  countdown: ['ring', 'resolve', 'roll'],
  hud: ['bar', 'pill', 'ring'],
  transition: ['slide', 'stack', 'fade'],
  reveal: ['settle', 'flip', 'sweep'],
  grid: ['glow', 'ring', 'strip'],
  expand: ['morph', 'lift', 'zoom'],
};

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

// ---- frame strips ------------------------------------------------------------------
// Screenshots take 100–300 ms each, too slow to catch a 500 ms morph. Each
// design is recorded as video instead, and frames are cut from it at exact
// offsets from the action that starts the motion.

type Step = { at: number; act?: (page: Page) => Promise<unknown> };

const STAGE_CROP = 'crop=460:800:580:0';
const RESULTS_CROP = 'crop=780:800:420:0';

function plan(el: string): { query: string; crop: string; start: (p: Page) => Promise<unknown>; frames: number[]; later?: Step[] } {
  const replay = (p: Page) => p.click('[data-testid="lab-replay"]');
  switch (el) {
    case 'countdown':
      return { query: '', crop: STAGE_CROP, start: replay, frames: [150, 700, 1300, 1900, 2500, 2950, 3150, 3300, 3450, 3650, 4100] };
    case 'hud':
      return { query: '&left=10', crop: STAGE_CROP, start: replay, frames: [3200, 3500, 3900, 6000, 9000, 12500] };
    case 'transition':
      return {
        query: '',
        crop: STAGE_CROP,
        start: (p) => p.click('[data-testid="lab-mark"]'),
        frames: [0, 200, 300, 340, 380, 420, 460, 520, 640, 1660, 1700, 1740, 1780, 1840, 1950, 2150],
        later: [{ at: 1650, act: (p) => p.click('[data-testid="lab-skip"]') }],
      };
    case 'reveal':
      return { query: '&n=11', crop: RESULTS_CROP, start: replay, frames: [100, 450, 800, 1100, 1400, 1700, 2000, 2400, 3000, 3600] };
    case 'grid':
      return { query: '&n=11&right=0.5', crop: RESULTS_CROP, start: replay, frames: [3800] };
    default:
      return {
        query: '&n=11',
        crop: RESULTS_CROP,
        start: async (p) => {
          await replay(p);
          await p.waitForTimeout(3600);
          await p.locator('[data-testid="result-tile"]').nth(3).click();
        },
        frames: [0, 70, 140, 210, 300, 420, 700, 1650, 1730, 1810, 1900, 2050, 2400],
        later: [{ at: 1600, act: (p) => p.keyboard.press('Escape') }],
      };
  }
}

async function record(b: Browser, dir: string, el: string, id: string): Promise<string | null> {
  const p = plan(el);
  const tmp = join(dir, 'video', `${el}-${id}`);
  rmSync(tmp, { recursive: true, force: true });
  const context = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: tmp, size: { width: 1280, height: 800 } } });
  const pg = await context.newPage();
  const t0 = Date.now();
  await pg.goto(`${BASE_URL}/dev/game-lab?el=${el}&${el}=${id}${p.query}`);
  await pg.waitForSelector('[data-testid="lab-preview"] [data-testid]', { timeout: 90_000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  // The expand plan waits inside `start`; its motion starts when that returns.
  await p.start(pg);
  const begin = Date.now() - t0;
  for (const step of p.later ?? []) {
    await pg.waitForTimeout(Math.max(0, step.at - (Date.now() - t0 - begin)));
    await step.act?.(pg);
  }
  await pg.waitForTimeout(Math.max(0, Math.max(...p.frames) + 400 - (Date.now() - t0 - begin)));
  const video = await pg.video()?.path();
  const elapsed = Date.now() - t0;
  await context.close();
  if (!video) return null;
  // The recording starts a little after the page is made: measure how much from its length.
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' });
  const lag = Math.max(0, elapsed - Number(probe.stdout.trim()) * 1000) || 0;
  // Cut the frames and lay them side by side.
  const parts = p.frames.map((ms, i) => {
    const out = join(tmp, `f${String(i).padStart(2, '0')}.png`);
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-ss', String(Math.max(0, begin + ms - lag) / 1000), '-frames:v', '1', '-vf', `${p.crop},scale=-2:400`, out]);
    return out;
  });
  const strip = join(dir, `${el}-${id}.png`);
  const args = parts.flatMap((f) => ['-i', f]);
  if (parts.length === 1) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, strip]);
  else spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, '-filter_complex', `hstack=inputs=${parts.length}`, strip]);
  return strip;
}

async function strips(browser: Browser, dir: string) {
  mkdirSync(dir, { recursive: true });
  // STRIPS=transition,expand records only those elements.
  const only = process.env.STRIPS?.split(',');
  for (const [el, ids] of Object.entries(DESIGNS)) {
    if (only && !only.includes(el)) continue;
    for (const id of ids) {
      const strip = await record(browser, dir, el, id);
      check(`strip ${el}-${id}`, strip !== null, strip);
    }
  }
}

const browser = await chromium.launch({ executablePath: findChrome() });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`${BASE_URL}/dev/game-lab`);
  await page.waitForSelector('[data-testid="lab-preview"]', { timeout: 90_000 });
  await page.waitForTimeout(1500);

  for (const [el, ids] of Object.entries(DESIGNS)) {
    await page.click(`[data-testid="lab-el-${el}"]`);
    for (const id of ids) {
      const name = `${el}-${id}`;
      if (el === 'hud') await page.getByText('10 s left', { exact: true }).click();
      await page.click(`[data-testid="lab-design-${id}"]`);
      await page.waitForTimeout(60);
      const picked = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').designs, 'double-take:game-dev:v1');
      check(`${name}: picked (kept with the dev settings)`, picked?.[el] === id, picked);

      if (el === 'countdown' || el === 'hud') {
        await page.waitForTimeout(4200);
        check(`${name}: the countdown lands in a running timer`, await page.locator('[data-testid="game-timer"]').isVisible());
      } else if (el === 'transition') {
        await page.waitForTimeout(1200);
        await page.click('[data-testid="lab-mark"]');
        await page.waitForTimeout(150);
        check(`${name}: a mark stamps the clip`, (await page.locator('[data-testid="mark-stamp"]').count()) > 0);
        await page.waitForTimeout(1000);
        await page.click('[data-testid="lab-skip"]');
        await page.waitForTimeout(800);
      } else {
        await page.click('[data-testid="lab-replay"]');
        await page.waitForTimeout(3600);
        const tiles = await page.locator('[data-testid="result-tile"]').count();
        check(`${name}: the results show the fake round`, tiles > 0, tiles);
        if (el === 'expand') {
          await page.locator('[data-testid="result-tile"]').nth(3).click();
          await page.waitForTimeout(900);
          check(`${name}: the clip opens full size`, await page.locator('[data-testid="clip-expanded"]').isVisible());
          await page.keyboard.press('Escape');
          await page.waitForSelector('[data-testid="clip-expanded"]', { state: 'detached', timeout: 5000 }).catch(() => {});
          check(`${name}: and closes back into its tile`, (await page.locator('[data-testid="clip-expanded"]').count()) === 0);
        }
      }
    }
  }
  // The simulations: a skill bot over rounds, a viewer for the feed ranker.
  await page.click('[data-testid="lab-el-skills"]');
  check('skill bot: the simulation runs', await page.waitForSelector('[data-testid="lab-sim-skills"]', { timeout: 60_000 }).then(() => true).catch(() => false));
  await page.click('[data-testid="lab-el-ranker"]');
  check('feed ranker: the simulation runs', await page.waitForSelector('[data-testid="lab-sim-ranker"]', { timeout: 60_000 }).then(() => true).catch(() => false));
  check('no page errors', errors.length === 0, errors);
  if (SHOTS) await strips(browser, SHOTS);
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
