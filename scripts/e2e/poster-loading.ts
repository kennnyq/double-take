/** Cold Home request counts against the local Worker; BASELINE=1 records the old behavior. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const phone of [false, true]) {
    const context = await browser.newContext({ viewport: phone ? { width: 430, height: 932 } : { width: 1280, height: 800 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
    const page = await context.newPage();
    const requests: { image: boolean; url: string }[] = [];
    page.on('request', r => { if (new URL(r.url()).port === '8789') requests.push({ image: r.resourceType() === 'image', url: r.url() }); });
    await page.goto(BASE_URL + '/#app');
    await page.locator('[aria-label^="Double take:"]').first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(10000);
    const initial = { workerRequests: requests.length, imageRequests: requests.filter(r => r.image).length, uniqueImages: new Set(requests.filter(r => r.image).map(r => r.url)).size };
    assert.ok(initial.workerRequests > 0, 'measurement must use local Worker 8789');
    console.log(JSON.stringify({ layout: phone ? 'phone' : 'desktop', ...initial }));
    if (!process.env.BASELINE) assert.ok(initial.uniqueImages <= 5, 'only nearby poster images load on Home open');
    if (!phone) {
      // Current and next are already decoded before navigation, not merely queued as lazy images.
      const ready = await page.locator('section.slide').evaluateAll(slides => slides.slice(0, 2).every(slide => {
        const images = [...slide.querySelectorAll<HTMLImageElement>('img.poster')];
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
      }));
      assert.ok(ready, 'current and next posters are loaded before advancing');
      if (!process.env.BASELINE) {
        for (let i = 0; i < 4; i++) {
          await page.getByRole('button', { name: 'Next video', exact: true }).click();
          await page.waitForTimeout(700);
          assert.ok(await page.locator('section.slide[aria-current="true"] img.poster').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), 'poster is ready on navigation');
        }
        const distinct = await page.locator('section.slide img').evaluateAll(images => new Set(images.map(i => i.getAttribute('src')).filter(Boolean)).size);
        assert.ok(distinct <= 5, 'poster sources stay bounded as navigation moves the window');
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
