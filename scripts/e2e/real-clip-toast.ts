/** Real footage uses the eye/gesture toast; Game still marks answers. */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';
import { verdictFromLabel, type RemoteClip } from '../../src/data/remote.ts';

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
async function open(phone: boolean, hide = false, game = false) {
  const context = await browser.newContext({ viewport: phone ? { width: 393, height: 778 } : { width: 1280, height: 800 }, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  await page.addInitScript((hide) => {
    localStorage.clear();
    localStorage.setItem('double-take:dev-settings:v1', JSON.stringify({ realClips: hide ? 'hideEye' : 'toast' }));
    localStorage.setItem('double-take.settings.v1', JSON.stringify({ revealGesture: 'both' }));
    localStorage.setItem('double-take.game-intro.v1', 'seen');
  }, hide);
  await page.route('**/feed', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.clips = (body.clips as RemoteClip[]).filter((c) => verdictFromLabel(c.label) === 'real' && c.width / c.height < 0.65).slice(0, 4);
    assert.ok(body.clips.length >= 2, 'fixture has real portrait footage');
    await route.fulfill({ response, json: body });
  });
  await page.goto(BASE_URL + (game ? '/play' : '/#app'));
  // Game's player can settle paused on direct entry; its marking policy is
  // available once the video is ready. Feed cases also verify live playback.
  await page.waitForFunction((game) => [...document.querySelectorAll('video')].some((v) => (game || !v.paused) && v.readyState >= 2), game, { timeout: 90000 });
  await page.waitForTimeout(1000);
  return { context, page };
}
async function point(page: Page) {
  return page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const v = videos.find((v) => !v.paused && v.readyState >= 2) ?? videos.find((v) => v.readyState >= 2)!;
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.35 };
  });
}
async function doubleTap(page: Page, phone: boolean) {
  const p = await point(page);
  if (phone) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(60); await page.touchscreen.tap(p.x, p.y); }
  else await page.mouse.dblclick(p.x, p.y, { delay: 60 });
}
async function expectToast(page: Page, name: string) {
  const alert = page.getByRole('alert');
  await alert.waitFor({ timeout: 5000 });
  assert.match(await alert.innerText(), /This one's real|Real · from @/);
  assert.equal(await page.locator('[aria-label="Close the walkthrough"]').count(), 0);
  const box = await alert.boundingBox();
  assert.ok(box && box.y > page.viewportSize()!.height * 0.6, 'toast stays below the clip center');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused && v.readyState >= 2)), 'toast keeps playback running');
  await alert.waitFor({ state: 'detached', timeout: 5000 });
  console.log(`ok ${name}: brief real-source toast, no walkthrough or playback pause`);
}
try {
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    const { context, page } = await open(phone);
    const eye = page.locator('[aria-label^="Double take:"]').filter({ visible: true }).first();
    assert.ok(!/Double take/i.test(await eye.innerText()), 'eye has no visible text label (font icon glyphs are allowed)');
    await eye.click();
    await page.getByRole('alert').waitFor();
    await page.waitForTimeout(300);
    const continuity = await page.evaluate(async () => {
      const alert = document.querySelector('[role="alert"]')!;
      (document.querySelector('[aria-label^="Double take:"]') as HTMLElement).click();
      const opacities: number[] = [];
      for (let i = 0; i < 12; i++) { await new Promise(requestAnimationFrame); opacities.push(Number(getComputedStyle(alert).opacity)); }
      return { same: alert === document.querySelector('[role="alert"]'), min: Math.min(...opacities) };
    });
    assert.ok(continuity.same && continuity.min > 0.8, `repeat retargets without snapping: ${JSON.stringify(continuity)}`);
    await expectToast(page, name + ' eye/repeated eye');
    await doubleTap(page, phone);
    await expectToast(page, name + ' double tap');
    const p = await point(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
    await expectToast(page, name + ' hold');
    if (!phone) {
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.press(' '); await page.waitForTimeout(60); await page.keyboard.press(' ');
      await expectToast(page, name + ' double Space');
      await page.keyboard.down(' '); await page.waitForTimeout(550); await page.keyboard.up(' ');
      await expectToast(page, name + ' hold Space');
    }
    await context.close();
    const hidden = await open(phone, true);
    assert.equal(await hidden.page.evaluate(() => [...document.querySelectorAll('[aria-label^="Double take:"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < innerHeight && !el.closest('[aria-hidden="true"]'); }).length), 0);
    await doubleTap(hidden.page, phone); await hidden.page.waitForTimeout(450);
    assert.equal(await hidden.page.getByRole('alert').count(), 0);
    console.log(`ok ${name}: Hide eye disables real-clip toast`);
    await hidden.context.close();
    const game = await open(phone, false, true);
    await game.page.waitForFunction(() => !!(window as any).__dtGame);
    await doubleTap(game.page, phone);
    await game.page.waitForFunction(() => (window as any).__dtGame?.guesses.length > 0, undefined, { timeout: 5000 });
    assert.equal(await game.page.getByRole('alert').count(), 0);
    console.log(`ok ${name}: Game marks the clip instead of showing a toast`);
    await game.context.close();
  }
} finally { await browser.close(); }
