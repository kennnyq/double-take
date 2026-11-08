/**
 * Browser check that the clip's icons are actually seen: when a clip is
 * paused its play icon is painted over the video, and the sound button is
 * painted, on the desktop feed (several clips) and the phone layout. Each
 * icon counts as painted when hiding it changes the screen.
 *
 * It caught the desktop pause icon and mute button sinking under the pooled
 * <video>: a transform on the card's stage made it a stacking context, so its
 * overlay painted below the video and only showed over transparent letterbox
 * bands (see also e2e:overlay).
 *
 * Also the phone's tab bar during a double take, for both dev options (stay,
 * fade), and that fading it doesn't move the video.
 *
 *   npm run e2e:icons                                   (dev server on 8081)
 *   BASE_URL=http://localhost:8089 npm run e2e:icons
 */
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

/** 'painted' when hiding the first on-screen match of `selector` changes the screen; 'hidden' when it doesn't; 'absent' when there's none. */
async function painted(page: Page, selector: string): Promise<'painted' | 'hidden' | 'absent'> {
  const box = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    }) as HTMLElement | undefined;
    if (!el) return null;
    el.dataset.e2eIcon = '1';
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
  if (!box) return 'absent';
  const shown = await page.screenshot({ clip: box });
  await page.evaluate(() => ((document.querySelector('[data-e2e-icon="1"]') as HTMLElement).style.visibility = 'hidden'));
  const hidden = await page.screenshot({ clip: box });
  await page.evaluate(() => {
    const el = document.querySelector('[data-e2e-icon="1"]') as HTMLElement;
    el.style.visibility = '';
    delete el.dataset.e2eIcon;
  });
  return shown.equals(hidden) ? 'hidden' : 'painted';
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });

  // Desktop: pause three clips (landscape and portrait).
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`${BASE_URL}/#app`);
    await page.waitForSelector('section.slide[aria-current="true"]', { timeout: 90_000 });
    await page.waitForTimeout(2500);
    for (let clip = 0; clip < 3; clip++) {
      const at = await page.evaluate(() => {
        const r = document.querySelector('section.slide[aria-current="true"] .tap-layer')!.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(at.x, at.y); // pause (after the double-click window)
      await page.waitForTimeout(900);
      const icon = await painted(page, 'section.slide[aria-current="true"] .paused-icon');
      const mute = await painted(page, 'section.slide[aria-current="true"] .mute-btn');
      check(`desktop clip ${clip}: the paused clip shows its play icon and sound button`, icon === 'painted' && mute === 'painted', { icon, mute });
      await page.mouse.click(at.x, at.y); // play
      await page.waitForTimeout(600);
      await page.click('[aria-label="Next video"]', { timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1800);
    }
    await page.context().close();
  }

  // Phone: tap to pause.
  {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`${BASE_URL}/#app`);
    await page.waitForSelector('[aria-label="Pause"]', { timeout: 90_000 });
    await page.waitForTimeout(2500);
    const at = await page.evaluate(() => {
      const e = [...document.querySelectorAll('[aria-label="Pause"]')].find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > -5 && r.top < 60 && r.height > 300;
      })!;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
    });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(1200);
    const icon = await painted(page, '[data-testid="paused-icon"]');
    const sound = await painted(page, '[aria-label="Unmute"], [aria-label="Mute"]');
    check('phone: the paused clip shows its play icon, and the sound button shows', icon === 'painted' && sound === 'painted', { icon, sound });
    await context.close();
  }

  // Phone: the tab bar during a double take, both dev options. Stay (default):
  // it stays seen. Fade: it fades out, takes no touches, and comes back on
  // exit. Either way its strip keeps its place, so the video's inset doesn't move.
  const stages: Record<string, string | null> = {};
  for (const mode of ['stay', 'fade'] as const) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.addInitScript((m) => {
      localStorage.clear();
      localStorage.setItem('double-take:dev-settings:v1', JSON.stringify({ tabBarInDoubleTake: m }));
    }, mode);
    await page.goto(`${BASE_URL}/#app`);
    await page.waitForSelector('[aria-label^="Double take"]', { timeout: 90_000 });
    await page.waitForTimeout(2500);
    const strip = () => page.evaluate(() => JSON.stringify(document.querySelector('[data-testid="tab-bar"]')?.getBoundingClientRect() ?? null));
    const before = await strip();
    for (const b of await page.$$('[aria-label^="Double take"]')) {
      const r = await b.boundingBox();
      if (r && r.y > 0 && r.y < 932) {
        await b.click();
        break;
      }
    }
    await page.waitForTimeout(1500);
    const during = await painted(page, '[data-testid="tab-bar"] [aria-label="Home"]');
    const look = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="tab-bar"]') as HTMLElement;
      const v = [...document.querySelectorAll('video')].find((x) => {
        const r = x.getBoundingClientRect();
        return r.top >= -5 && r.top < 200 && r.height > 200;
      });
      return { events: getComputedStyle(bar).pointerEvents, video: v ? JSON.stringify(v.getBoundingClientRect()) : null };
    });
    stages[mode] = look.video;
    const inPlace = (await strip()) === before;
    if (mode === 'stay') {
      check('phone, tab bar "stay": it stays seen and usable during a double take', during === 'painted' && look.events !== 'none' && inPlace, { during, look, inPlace });
    } else {
      check('phone, tab bar "fade": it fades out during a double take and takes no touches; its strip stays put', during === 'hidden' && look.events === 'none' && inPlace, {
        during,
        look,
        inPlace,
      });
    }
    await page.click('[aria-label="Close the walkthrough"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const after = await painted(page, '[data-testid="tab-bar"] [aria-label="Home"]');
    check(`phone, tab bar "${mode}": it's seen again after the double take`, after === 'painted', { after });
    await context.close();
  }
  check('phone: the double take insets the video the same with the tab bar fading or staying', stages.stay != null && stages.stay === stages.fade, stages);

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
