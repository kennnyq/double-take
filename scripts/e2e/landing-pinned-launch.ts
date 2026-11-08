/** Hero and wall launch the shared pin, including when no pinned tile is visible. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';
const LEAD = 'x-1996831827357847987';
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const phone of [false, true]) for (const kind of ['hero', 'wall', 'wall-fallback']) {
    const context = await browser.newContext({ viewport: phone ? { width: 393, height: 778 } : { width: 1280, height: 800 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    await cacheFeed(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto(BASE_URL + '/?fcta=wall');
    await page.waitForSelector('.lt-gallery [data-cell]');
    if (kind !== 'hero') {
      await page.locator('.lt-final').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(1600);
    }
    const before = await page.evaluate((fallback) => {
      const pins = [...document.querySelectorAll<HTMLElement>('[data-tile][data-clip="0"]')];
      if (fallback) pins.forEach((el) => { el.style.display = 'none'; });
      const visible = pins.filter((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; }).length;
      const state = { visible, picked: null as string | null, frames: [] as { opacity: number; ready: number; source: string; covered: boolean }[], run: true };
      (window as any).__pinLaunch = state;
      const tick = () => {
        if (!state.run) return;
        const lifted = document.querySelector<HTMLElement>('.lt-lift');
        if (lifted && state.picked === null) state.picked = [...document.querySelectorAll<HTMLElement>('[data-tile]')].find((el) => el.style.visibility === 'hidden')?.dataset.clip ?? null;
        const hi = lifted?.querySelector<HTMLVideoElement>('.lt-hi');
        if (hi) state.frames.push({ opacity: Number(getComputedStyle(hi).opacity), ready: hi.readyState, source: hi.currentSrc, covered: !!lifted?.querySelector('canvas, video:not(.lt-hi)') });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return { visible };
    }, kind.endsWith('fallback'));
    await page.locator(kind === 'hero' ? '.lt-hero .lt-cta' : '.lt-final .lt-cta').click();
    await page.waitForFunction(() => location.hash === '#app' && !document.querySelector('.lt-root'), undefined, { timeout: 25000 });
    await page.waitForFunction((komodo) => [...document.querySelectorAll('video')].some((v) => !v.paused && v.readyState >= 2 && v.currentSrc.includes(komodo)), LEAD, { timeout: 10000 });
    const state = await page.evaluate(() => { const s = (window as any).__pinLaunch; s.run = false; return s; });
    assert.ok(state.frames.length > 8, 'launch retains its animated flight');
    assert.ok(state.frames.some((f: any) => f.opacity > 0.05 && f.opacity < 0.95), 'komodo fades in continuously');
    assert.ok(state.frames.every((f: any) => f.opacity < 0.05 || (f.ready >= 2 && f.source.includes(LEAD))), 'visible full video is decoded komodo footage, never an unloaded black video');
    assert.ok(state.frames.every((f: any) => f.opacity >= 0.95 || f.covered), 'original tile remains beneath the crossfade');
    if (before.visible) assert.equal(state.picked, '0', 'visible komodo tile wins over proximity');
    if (kind.endsWith('fallback')) assert.equal(before.visible, 0, 'fallback has no visible komodo tile');
    console.log(`ok ${phone ? 'phone' : 'desktop'} ${kind}: komodo leads, visible pins ${before.visible}, survivor ${state.picked}, continuous decoded crossfade`);
    await context.close();
  }
} finally { await browser.close(); }
