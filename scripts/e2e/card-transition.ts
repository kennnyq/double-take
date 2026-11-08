/** Persistent card + footer, changing copy and interrupted next/back, on both layouts. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE_URL, findChrome } from './browser.ts';

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const phone of [false, true]) {
    const context = await browser.newContext({
      viewport: phone ? { width: 430, height: 932 } : { width: 1280, height: 800 },
      ...(phone ? { hasTouch: true, isMobile: true } : {}),
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.clear());
    await page.route(/tells[^/]*\.json/, async (route) => {
      await route.fulfill({ json: { version: 1, tells: [
        { id: 'first', category: 'shape', label: 'First annotation.', t0: 1, t1: 2, placement: 'top' },
        { id: 'second', category: 'shape', label: 'Second annotation has enough extra words to occupy several lines, changing the size of the card while its bottom controls remain visible.', t0: 3, t1: 4, placement: 'bottom' },
        { id: 'third', category: 'shape', label: 'Third annotation.', t0: 5, t1: 6, placement: 'top' },
      ] } });
    });
    await page.goto(BASE_URL + '/#app');
    await page.locator('[aria-label^="Double take"]').first().click({ timeout: 90000 });
    const card = page.getByTestId('dt-card');
    await card.getByText('First', { exact: true }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1400);
    await card.evaluate((el) => {
      const w = window as any;
      w.savedCard = el;
      w.savedBack = el.querySelector('[aria-label="Previous tell"]');
      w.savedFooter = w.savedBack.parentElement;
      w.footerSamples = [];
      w.sampleFooter = true;
      const tick = () => {
        if (!w.sampleFooter) return;
        w.footerSamples.push({
          connected: el.isConnected,
          opacity: Number(getComputedStyle(w.savedFooter).opacity),
          transform: getComputedStyle(w.savedFooter).transform,
          cardOpacity: Number(getComputedStyle(el).opacity),
        });
        requestAnimationFrame(tick);
      };
      tick();
    });
    await card.getByRole('button', { name: 'Next tell', exact: true }).click();
    await card.getByText('Second', { exact: true }).waitFor();
    await page.waitForTimeout(1500);
    const result = await card.evaluate((el) => {
      const w = window as any;
      w.sampleFooter = false;
      return {
        same: el === w.savedCard && el.querySelector('[aria-label="Previous tell"]') === w.savedBack,
        samples: w.footerSamples,
      };
    });
    assert.ok(result.same, 'shell and navigation button retain their identity');
    assert.ok(result.samples.length > 10);
    for (const s of result.samples) {
      assert.ok(s.connected && s.opacity > 0.99 && s.cardOpacity > 0.99, 'footer and shell never fade between tells');
      assert.ok(s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)', 'footer does not replay its rise');
    }
    await card.getByRole('button', { name: 'Previous tell' }).click();
    await page.waitForTimeout(100);
    // This rapid reversal targets the second tell again before the first has settled.
    await page.getByRole('button', { name: 'Next tell', exact: true }).first().click({ force: true });
    await card.getByText('Second', { exact: true }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await card.count(), 1);
    await card.getByRole('button', { name: 'Next tell', exact: true }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Close the walkthrough' }).click();
    await card.waitFor({ state: 'detached' });
    await page.waitForTimeout(800);
    assert.equal(await card.count(), 0, 'closing cancels any pending annotation');
    console.log('ok ' + (phone ? 'phone' : 'desktop') + ': persistent shell/footer, text replacement, reversal and close');
    await context.close();
  }
} finally {
  await browser.close();
}
