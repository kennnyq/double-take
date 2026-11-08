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
    await card.getByText('First', { exact: true }).filter({ visible: true }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1400);
    const replay = card.getByRole('button', { name: 'Replay this annotation' });
    assert.ok(await replay.isEnabled());
    const scrubCount = await page.evaluate(() => (window as any).__dtMarks.filter((m: any) => m.kind === 'scrubStart').length);
    await replay.click();
    await page.waitForTimeout(1200);
    const afterReplay = await page.evaluate(() => (window as any).__dtMarks.filter((m: any) => m.kind === 'scrubStart').length);
    assert.equal(afterReplay, scrubCount + 1, 'first back arrow scrubs to the current loop start');
    await card.getByText('First', { exact: true }).filter({ visible: true }).waitFor();
    await card.evaluate((el) => {
      const w = window as any;
      w.savedCard = el;
      w.savedBack = el.querySelector('[aria-label="Replay this annotation"]');
      w.savedFooter = w.savedBack.parentElement;
      w.footerSamples = [];
      el.addEventListener('click', () => { w.inputAt = performance.now(); }, { once: true, capture: true });
      const glass = el.querySelector('[data-testid="dt-card-glass"]')!;
      w.sampleFooter = true;
      const tick = () => {
        if (!w.sampleFooter) return;
        w.footerSamples.push({
          at: performance.now(),
          top: glass.getBoundingClientRect().top,
          bottom: glass.getBoundingClientRect().bottom,
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
    await card.getByText('Second', { exact: true }).filter({ visible: true }).waitFor();
    await page.waitForTimeout(1500);
    const result = await card.evaluate((el) => {
      const w = window as any;
      w.sampleFooter = false;
      return {
        same: el === w.savedCard && el.querySelector('[aria-label="Previous tell"]') === w.savedBack,
        samples: w.footerSamples,
        inputAt: w.inputAt,
      };
    });
    assert.ok(result.same, 'shell and navigation button retain their identity');
    assert.ok(result.samples.length > 10);
    for (const s of result.samples) {
      assert.ok(s.connected && s.opacity > 0.99 && s.cardOpacity > 0.99, 'footer and shell never fade between tells');
      assert.ok(s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)', 'footer does not replay its rise');
    }
    const samples = result.samples.filter((s: any) => s.at >= result.inputAt);
    const initial = result.samples[0];
    const moved = samples.find((s: any) => Math.abs(s.bottom - initial.bottom) > 1);
    assert.ok(moved && moved.at - result.inputAt < 150, 'card responds within 150 ms of the accepted input');
    const resized = samples.find((s: any) => Math.abs((s.bottom - s.top) - (initial.bottom - initial.top)) > 1);
    assert.ok(resized && resized.at - result.inputAt < 150, 'resize starts alongside travel, before the old text has exited');
    for (const edge of ['top', 'bottom']) {
      const end = samples.at(-1)[edge];
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i];
        const b = samples.find((s: any) => s.at >= a.at + 65);
        if (!b || Math.abs(end - a[edge]) < 20 || Math.abs(a[edge] - initial[edge]) < 5) continue;
        assert.ok(Math.abs(b[edge] - a[edge]) > 1, edge + ' keeps moving through text replacement');
      }
    }
    console.log('motion latency ms:', Math.round(moved.at - result.inputAt), 'resize:', Math.round(resized.at - result.inputAt));
    await card.getByRole('button', { name: 'Previous tell' }).click();
    await page.waitForTimeout(100);
    // This rapid reversal targets the second tell again before the first has settled.
    // Dispatch to the chosen control: a forced coordinate click can hit the
    // moving back arrow instead as the card crosses the tap zone.
    await card.getByRole('button', { name: 'Next tell', exact: true }).evaluate((el) => (el as HTMLElement).click());
    await card.getByText('Second', { exact: true }).filter({ visible: true }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await card.count(), 1);
    const restoredHeight = await card.getByTestId('dt-card-glass').evaluate((el) => el.getBoundingClientRect().height);
    const settled = result.samples.at(-1);
    assert.ok(Math.abs(restoredHeight - (settled.bottom - settled.top)) < 1, 'reversal restores the visible text height: ' + restoredHeight + ' vs ' + (settled.bottom - settled.top));
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
