/**
 * Browser check for the double take's motion: the video never jumps to a
 * timestamp. Opening it scrubs (fast-forwards or rewinds) to the first tell,
 * the slow-mo loop restarts are the only jumps, and closing carries on from
 * where the loop was. Runs on the desktop layout and the phone layout.
 *
 *   npm run e2e:flow                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8089 npm run e2e:flow
 *
 * Needs a running dev server (dev build: the walkthrough logs its loop
 * restarts and scrubs to `window.__dtMarks`) and a Chromium (see browser.ts).
 * Every frame, the active <video>'s `currentTime` is sampled; consecutive
 * samples may differ by at most MAX_STEP seconds (more for late frames, up to
 * MAX_SPEED), except right after a loop restart, or when the clip itself wraps
 * from its end to 0 outside the walkthrough. The clip is moved near its end
 * first, so opening has a long way to rewind.
 */
import { chromium, type Browser } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

/**
 * The largest move between two samples that still reads as motion: 0.6 s, or
 * more when frames come late (a long scrub peaks near 14 s of video per second).
 */
const MAX_STEP = 0.6;
const MAX_SPEED = 20;
/**
 * A scrub eases in and out, so its big steps come between other big steps. A
 * jump is a big step next to a still (or slow-mo) one: a neighbouring step
 * under this many seconds. (Sampling is uneven, so one sample can cover two
 * of the scrub's seeks, and two samples can see the same seek; only
 * isolated big steps count.)
 */
const STILL = 0.2;
/** A loop restart shows up in the samples within this long. */
const RESTART_GRACE_MS = 250;

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

type Layout = 'desktop' | 'phone';
type Sample = { at: number; t: number[] };
type Mark = { kind: string; at: number };

async function run(browser: Browser, layout: Layout) {
  const context = await browser.newContext(
    layout === 'desktop'
      ? { viewport: { width: 1280, height: 800 } }
      : { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
  );
  const page = await context.newPage();
  await page.addInitScript((l) => {
    localStorage.clear();
    // The phone tries the "Text" end cue (the faint "Tap to …" line); desktop keeps the default (a check button).
    if (l === 'phone') localStorage.setItem('double-take:dev-settings:v1', JSON.stringify({ endCue: 'text' }));
    // Every frame: each <video>'s currentTime.
    const w = window as unknown as { __samples: Sample[]; __sampling: boolean };
    w.__samples = [];
    w.__sampling = false;
    const tick = () => {
      if (w.__sampling) w.__samples.push({ at: performance.now(), t: [...document.querySelectorAll('video')].map((v) => v.currentTime) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, layout);
  await page.goto(`${BASE_URL}/#app`);
  await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);

  // Start far from the first tell (near the clip's end), so the scrub has a long way to go.
  const startAt = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((e) => !e.paused && e.duration > 0);
    if (v) v.currentTime = Math.max(0, v.duration - 1.5);
    return v ? v.currentTime : -1;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => ((window as unknown as { __sampling: boolean }).__sampling = true));
  await page.waitForTimeout(400);
  await page.click('[aria-label^="Double take"]');
  await page.waitForSelector('[aria-label="Close the walkthrough"]', { timeout: 10_000 });
  // Long enough for the scrub and a few slow-mo loops.
  await page.waitForTimeout(9000);
  // The card: only the reason, and no labels.
  // The newest card's own text (the page holds other clips' captions too).
  const card = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="dt-card"]')] as HTMLElement[];
    return cards.length ? cards[cards.length - 1].innerText : '';
  });
  const finish = await page.evaluate(() => document.querySelectorAll('[aria-label="Finish the walkthrough"]').length);
  check(layout + ': single annotation has no navigation arrows', await page.getByTestId('dt-card').getByRole('button').count() === 1, {});
  if (layout === 'desktop') {
    // A single annotation uses a finish prompt regardless of the end-cue setting.
    check('desktop: the card carries no labels and offers a finish button', finish >= 2 && /Click to finish/.test(card) && !/AI draft|Slow-mo|slow mo|Not shown on screen/i.test(card), {
      card: card.slice(0, 300),
      finish,
    });
    // → goes on: on the last tell, that ends the walkthrough.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => !!document.querySelector('[aria-label="Close the walkthrough"]'));
    check('desktop: → on the last tell ends the walkthrough', !open, { open });
  } else {
    // "Text" end cue, worded for touch.
    check('phone: the card says "Tap to …" and carries no labels', /Tap to (continue|finish)/.test(card) && !/AI draft|Slow-mo|slow mo|Not shown on screen/i.test(card), {
      card: card.slice(0, 300),
    });
    await page.getByTestId('dt-card').getByRole('button', { name: 'Finish the walkthrough' }).click();
  }
  await page.waitForTimeout(1500);
  const { samples, marks } = await page.evaluate(() => {
    const w = window as unknown as { __samples: Sample[]; __sampling: boolean; __dtMarks?: Mark[] };
    w.__sampling = false;
    return { samples: w.__samples, marks: w.__dtMarks ?? [] };
  });
  await context.close();

  // The active video: the one whose time moved the most.
  const n = samples[0]?.t.length ?? 0;
  const travel = Array.from({ length: n }, (_, i) =>
    samples.reduce((sum, s, k) => (k && s.t.length === n ? sum + Math.abs(s.t[i] - samples[k - 1].t[i]) : sum), 0),
  );
  const v = travel.indexOf(Math.max(...travel));
  const series = samples.filter((s) => s.t.length === n).map((s) => ({ at: s.at, t: s.t[v] }));
  const restarts = marks.filter((m) => m.kind === 'loop').map((m) => m.at);
  const scrubStart = marks.find((m) => m.kind === 'scrubStart')?.at;
  const scrubEnd = marks.find((m) => m.kind === 'scrubEnd')?.at;

  const jumps: { at: number; from: number; to: number }[] = [];
  for (let k = 1; k < series.length; k++) {
    const a = series[k - 1];
    const b = series[k];
    if (Math.abs(b.t - a.t) <= Math.max(MAX_STEP, (MAX_SPEED * (b.at - a.at)) / 1000)) continue;
    // Neighbouring moves, skipping repeated samples (two samples between seeks).
    let i = k - 2;
    while (i >= 0 && series[i].t === a.t) i--;
    let j = k + 1;
    while (j < series.length && series[j].t === b.t) j++;
    const before = i >= 0 ? Math.abs(a.t - series[i].t) : 0;
    const after = j < series.length ? Math.abs(series[j].t - b.t) : 0;
    if (Math.min(before, after) >= STILL) continue;
    if (restarts.some((r) => b.at >= r - 20 && b.at - r <= RESTART_GRACE_MS)) continue;
    // The clip's own loop (end → 0) during normal playback.
    if (b.t < 0.5 && a.t > b.t && restarts.length === 0) continue;
    if (b.t < 0.5 && a.t > b.t && scrubStart !== undefined && b.at < scrubStart) continue;
    jumps.push({ at: Math.round(b.at), from: +a.t.toFixed(2), to: +b.t.toFixed(2) });
  }
  check(`${layout}: no jumps outside loop restarts`, jumps.length === 0, { jumps: jumps.slice(0, 5), samples: series.length });

  const scrubbed = scrubStart !== undefined && scrubEnd !== undefined && scrubEnd > scrubStart;
  const during = scrubbed ? series.filter((s) => s.at > scrubStart! && s.at < scrubEnd!) : [];
  const distinct = new Set(during.map((s) => s.t.toFixed(2))).size;
  const travelled = during.length ? Math.abs(during[during.length - 1].t - during[0].t) : 0;
  check(`${layout}: opening scrubs to the tell through several frames`, scrubbed && distinct >= 5, {
    startAt,
    travelled,
    scrubbed,
    ms: scrubbed ? Math.round(scrubEnd! - scrubStart!) : 0,
    distinct,
  });
  check(`${layout}: the slow-mo loop restarted`, restarts.length >= 1, { restarts: restarts.length });
  const tail = series.filter((s) => s.at > series[series.length - 1].at - 800);
  check(`${layout}: playback carries on after closing`, tail.length > 2 && tail[tail.length - 1].t !== tail[0].t, {
    from: tail[0]?.t,
    to: tail[tail.length - 1]?.t,
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
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
