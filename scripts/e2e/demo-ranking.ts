/** Shared ranking reaches Home, untimed Game and the animated landing atlas. */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';
import { toClip, type RemoteClip } from '../../src/data/remote.ts';
import { heroCandidates, QUALITY_TIER_WIDTH, scoreClip } from '../../src/data/rank.ts';
import { galleryPicks } from '../../src/landing/atlas.ts';

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
async function feed(page: Page, path: string) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/feed' && r.ok(), { timeout: 90000 });
  await page.goto(BASE_URL + path);
  return ((await (await response).json()).clips as RemoteClip[]).map(toClip);
}
async function firstSource(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.currentSrc.includes('/media/')), { timeout: 60000 });
  return page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const video = videos.find((v) => !v.paused && v.currentSrc.includes('/media/')) ?? videos.find((v) => v.currentSrc.includes('/media/'))!;
    return decodeURIComponent(video.currentSrc.split('/media/')[1].split('/')[0]);
  });
}
try {
  for (const [name, path, phone, original] of [
    ['desktop Home', '/#app', false, false],
    ['phone Home', '/#app', true, false],
    ['untimed Game', '/play', false, false],
    ['Original Home', '/#app', false, true],
  ] as const) {
    const context = await browser.newContext({ viewport: phone ? { width: 430, height: 932 } : { width: 1280, height: 800 } });
    const page = await context.newPage();
    await cacheFeed(page);
    await page.addInitScript((original) => {
      localStorage.clear();
      if (original) localStorage.setItem('double-take:dev-settings:v1', JSON.stringify({ feedOrder: 'original' }));
    }, original);
    let tellsRequests = 0;
    page.on('request', (r) => { if (/tells[^/]*\.json/.test(r.url())) tellsRequests++; });
    const clips = await feed(page, path);
    const source = await firstSource(page);
    const clip = clips.find((c) => c.sourceId === source)!;
    assert.ok(clip, 'playing clip belongs to the signed feed');
    if (original) assert.equal(source, clips[0].sourceId);
    else {
      const bestTier = Math.max(...clips.filter((c) => c.verdict === 'ai').map((c) => Math.floor(scoreClip(c) / QUALITY_TIER_WIDTH)));
      assert.equal(clip.verdict, 'ai');
      assert.equal(Math.floor(scoreClip(clip) / QUALITY_TIER_WIDTH), bestTier);
    }
    assert.ok(tellsRequests < 8, `ranking did not fetch all annotations (${tellsRequests})`);
    console.log(`ok ${name}: ${source}, score ${scoreClip(clip)}, ${tellsRequests} tells requests`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await cacheFeed(page);
  const atlasResponse = page.waitForResponse((r) => r.url().includes('/gallery-atlas/atlas.json') && r.ok());
  const clips = await feed(page, '/');
  const atlas = await (await atlasResponse).json();
  const allowed = new Set(galleryPicks(clips, atlas, 48).map((p) => p.cell));
  await page.waitForSelector('.lt-gallery [data-cell]');
  const checkTiles = async () => {
    const cells = await page.locator('.lt-gallery [data-cell]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.cell)));
    assert.ok(cells.length);
    assert.ok(cells.every((cell) => allowed.has(cell)), `atlas escaped shortlist: ${[...new Set(cells)]}`);
  };
  await checkTiles();
  await page.waitForTimeout(18000); // allow reel handovers to choose their next cells
  await checkTiles();
  console.log(`ok landing tiles: all cells remain in the ${allowed.size}-clip quality shortlist`);
  // Loading the showcase is lazy: bring the feature section into view.
  const showcaseIds = new Set(heroCandidates(clips.filter((c) => c.verdict === 'ai' && (c.aspect ?? 1) < 0.75 && c.tellsUrl), 3).map((c) => c.sourceId));
  await page.locator('#features').evaluate((el) => window.scrollTo(0, (el as HTMLElement).offsetTop));
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.currentSrc.includes('/media/') && v.currentSrc.includes('720.mp4')), { timeout: 60000 });
  const sources = await page.locator('video').evaluateAll((videos) => videos.map((v) => (v as HTMLVideoElement).currentSrc));
  assert.ok(sources.some((url) => [...showcaseIds].some((id) => url.includes(id!))), 'showcase uses a top AI candidate');
  console.log('ok landing showcase: top AI candidate');
  await context.close();
} finally {
  await browser.close();
}
