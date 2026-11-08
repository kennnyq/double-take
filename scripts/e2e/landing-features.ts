/**
 * The landing's features section in a browser: frame strips of each design
 * (screenshots along the scroll) and frame timings while scrolling through it.
 *
 *   BASE_URL=http://localhost:8101 node scripts/e2e/landing-features.ts [out-dir]
 *
 * Options (env): SIZES="1440x900,390x844", DESIGNS="side,stage,rail",
 * SHOTS=0 (timings only), TIMING=0 (shots only).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';

const out = process.argv[2] ?? 'landing-features-out';
const sizes = (process.env.SIZES ?? '1440x900,390x844').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const designs = (process.env.DESIGNS ?? 'side,stage,rail').split(',');
const shots = process.env.SHOTS !== '0';
const timing = process.env.TIMING !== '0';
/** Points along the track to photograph, in screens from its start. */
const POINTS = (process.env.POINTS ?? '-0.6,0.35,1.15,1.9,2.9,3.9,5.2,6.2,7.3,8.6,10.6,12.4,14.6,16.2,18.6')
  .split(',')
  .map(Number);

interface Track {
  top: number;
  h: number;
  starts: number[];
  total: number;
}

async function track(page: Page): Promise<Track> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.lt-root')!;
    const t = document.querySelector<HTMLElement>('#features')!;
    const h = t.querySelector<HTMLElement>('.ft-stage')!.clientHeight;
    const top = t.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    return { top, h, starts: (t.dataset.starts ?? '').split(',').map(Number), total: t.offsetHeight / h - 1 };
  });
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => document.querySelector<HTMLElement>('.lt-root')!.scrollTo({ top }), y);
}

/** Scrolls through the whole track at a steady pace, recording every frame's time. */
async function frameTimes(page: Page, t: Track, seconds: number) {
  await scrollTo(page, t.top - t.h);
  await page.waitForTimeout(800);
  return page.evaluate(
    ({ from, to, ms }) =>
      new Promise<number[]>((resolve) => {
        const root = document.querySelector<HTMLElement>('.lt-root')!;
        const times: number[] = [];
        let start = -1;
        let last = 0;
        const frame = (now: number) => {
          if (start < 0) start = now;
          else times.push(now - last);
          last = now;
          const k = Math.min(1, (now - start) / ms);
          root.scrollTop = from + (to - from) * k;
          if (k < 1) requestAnimationFrame(frame);
          else resolve(times);
        };
        requestAnimationFrame(frame);
      }),
    { from: t.top - t.h, to: t.top + (t.total + 0.5) * t.h, ms: seconds * 1000 },
  );
}

function summary(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    frames: times.length,
    fps: Math.round((times.length * 1000) / sum),
    median: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    p99: +q(0.99).toFixed(1),
    worst: +sorted[sorted.length - 1].toFixed(1),
    over20: times.filter((x) => x > 20).length,
  };
}

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
mkdirSync(out, { recursive: true });
const results: Record<string, unknown> = {};
for (const [w, h] of sizes) {
  for (const design of designs) {
    const mobile = w < 760;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await cacheFeed(page);
    page.on('pageerror', (e) => console.error(`[${design} ${w}] page error:`, e.message));
    await page.goto(`${BASE_URL}/?fdesign=${design}&fmeter=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#features .ft-device', { timeout: 60_000 });
    const t = await track(page);
    // Bring the section near so its clips load.
    await scrollTo(page, t.top - t.h);
    await page.waitForTimeout(2500);
    if (shots) {
      for (const [i, at] of POINTS.entries()) {
        if (at > t.total + 0.9) continue;
        await scrollTo(page, t.top + at * t.h);
        await page.waitForTimeout(1100);
        await page.screenshot({ path: join(out, `${design}-${w}x${h}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 70 });
      }
    }
    if (timing) {
      const times = await frameTimes(page, t, Math.max(8, t.total * 0.9));
      results[`${design} ${w}x${h}`] = summary(times);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
