/** Shared ranking reaches Home, untimed Game and the animated landing atlas. */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { BASE_URL, cacheFeed, findChrome } from './browser.ts';
import { toClip, type RemoteClip } from '../../src/data/remote.ts';
import { heroCandidates, QUALITY_TIER_WIDTH, scoreClip } from '../../src/data/rank.ts';
import { readTellsFile } from '../../src/annotations/format.ts';
import { walkthroughSteps, replayWindow } from '../../src/annotations/walkthrough.ts';
import { videoRect } from '../../src/feed/tells.ts';
import { galleryPicks } from '../../src/landing/atlas.ts';

const ROOM = 'x-2106432142217765020';
const CAT = 'x-2082309674960032067';
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
      assert.equal(source, ROOM, 'room is the pinned first AI clip');
      assert.equal(clip.verdict, 'ai');
      assert.equal(Math.floor(scoreClip(clip) / QUALITY_TIER_WIDTH), bestTier);
    }
    assert.ok(tellsRequests < 8, `ranking did not fetch all annotations (${tellsRequests})`);
    console.log(`ok ${name}: ${source}, score ${scoreClip(clip)}, ${tellsRequests} tells requests`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: process.env.HERO_PHONE ? { width: 430, height: 932 } : { width: 1280, height: 800 } });
  const page = await context.newPage();
  await cacheFeed(page);
  const atlasResponse = page.waitForResponse((r) => r.url().includes('/gallery-atlas/atlas.json') && r.ok());
  const roomTells = page.waitForResponse((r) => r.url().includes(ROOM) && /tells[^/]*\.json/.test(r.url()) && r.ok(), { timeout: 90000 });
  const clips = await feed(page, '/');
  const atlas = await (await atlasResponse).json();
  const picks = galleryPicks(clips, atlas, 48);
  // Session seeds may choose different clips in the last included tier.
  const cutoff = Math.min(...picks.map((p) => Math.floor(scoreClip(clips[p.index]) / QUALITY_TIER_WIDTH)));
  const allowed = new Set(atlas.ids.flatMap((id: string, cell: number) => {
    const clip = clips.find((c) => c.sourceId === id);
    return clip && (clip.aspect ?? 1) < 1 && Math.floor(scoreClip(clip) / QUALITY_TIER_WIDTH) >= cutoff ? [cell] : [];
  }));
  assert.ok(allowed.size >= 10, 'hero shortlist keeps at least ten distinct clips');
  await page.waitForSelector('.lt-gallery [data-cell]');
  const checkTiles = async () => {
    const cells = await page.locator('.lt-gallery [data-cell]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.cell)));
    assert.ok(new Set(cells).size >= 10, 'hero wall displays at least ten distinct clips');
    assert.ok(cells.every((cell) => allowed.has(cell)), `atlas escaped top candidate tiers: ${[...new Set(cells)]}`);
    const strips = await page.locator('.lt-gallery .lt-row, .lt-gallery .lt-col').evaluateAll((els) => els.map((el) =>
      [...new Map([...el.querySelectorAll<HTMLElement>('[data-twin][data-cell]')].map((tile) => [tile.dataset.twin, Number(tile.dataset.cell)])).values()],
    ));
    for (let k = 0; k < strips.length; k++) {
      const row = strips[k];
      row.forEach((cell, i) => assert.notEqual(cell, row[(i + 1) % row.length], 'no adjacent repeated clips, including wrap'));
      for (const other of strips.slice(k + 1, k + 3)) assert.ok(row.every((cell) => !other.includes(cell)), 'three-row/column separation');
    }
  };
  await checkTiles();
  await page.waitForTimeout(18000); // allow reel handovers to choose their next cells
  await checkTiles();
  console.log(`ok landing tiles: 12+ distinct clips remain in the preferred tiers, with three-strip separation`);
  // Loading the showcase is lazy: bring the feature section into view.
  const showcaseIds = new Set(heroCandidates(clips.filter((c) => c.verdict === 'ai' && (c.aspect ?? 1) < 0.75 && c.tellsUrl), 3, { minimum: 0 }).map((c) => c.sourceId));
  assert.ok(!showcaseIds.has(CAT), 'cat is outside the preferred showcase band');
  await page.locator('#features').evaluate((el) => el.scrollIntoView());
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.currentSrc.includes('/media/') && v.currentSrc.includes('720.mp4')), { timeout: 60000 });
  const sources = await page.locator('video').evaluateAll((videos) => videos.map((v) => (v as HTMLVideoElement).currentSrc));
  assert.ok(sources.some((url) => [...showcaseIds].some((id) => url.includes(id!))), 'showcase uses a top AI candidate');
  assert.ok(sources.some((url) => url.includes(ROOM)), 'landing walkthrough uses the room');
  const tells = walkthroughSteps(readTellsFile(await (await roomTells).json()).tells).filter((t) => t.box);
  assert.equal(tells.length, 3);
  const words = await page.locator('.ft-card .ft-text').allTextContents();
  assert.deepEqual(words.map((s) => s.replace(/\s+/g, ' ').trim()), tells.map((t) => (t.detail ?? t.label).replace(/\s+/g, ' ').trim()));
  for (let i = 0; i < tells.length; i++) {
    await page.evaluate((i) => {
      const root = document.querySelector<HTMLElement>('.lt-root')!;
      const feature = document.querySelector<HTMLElement>('#features')!;
      const stage = feature.querySelector<HTMLElement>('.ft-stage')!;
      const starts = feature.dataset.starts!.split(',').map(Number);
      const k = feature.dataset.ids!.split(',').indexOf('scroll');
      const p = 0.25 + 0.68 * (i + 0.6) / 3;
      const top = feature.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTo({ top: top + stage.clientHeight * (starts[k] + (starts[k + 1] - starts[k]) * p), behavior: 'instant' });
    }, i);
    await page.waitForTimeout(1600);
    const geometry = await page.evaluate((room) => {
      const v = [...document.querySelectorAll<HTMLVideoElement>('.ft-clip video')].find((v) => v.currentSrc.includes(room))!;
      const hole = v.closest('.ft-clip')!.querySelector<HTMLElement>('.ft-hole')!;
      const m = new DOMMatrix(getComputedStyle(hole).transform);
      return { w: v.clientWidth, h: v.clientHeight, aspect: v.videoWidth / v.videoHeight, x: m.m41, y: m.m42, time: v.currentTime };
    }, ROOM);
    const frame = videoRect(geometry.w, geometry.h, geometry.aspect, 'cover');
    const box = tells[i].box!;
    const error = Math.hypot(geometry.x - (frame.x + (box.x + box.w / 2) * frame.w), geometry.y - (frame.y + (box.y + box.h / 2) * frame.h));
    assert.ok(error < 2, `room tell ${i + 1} spotlight aligns (${error.toFixed(2)}px)`);
    const replay = replayWindow(tells[i]);
    assert.ok(geometry.time >= replay.from - 0.2 && geometry.time <= replay.to + 0.2, 'room video is in the matching annotation loop');
  }
  console.log('ok landing showcase: room clip, three matching annotation texts, aligned spotlights and replay times');
  await context.close();
} finally {
  await browser.close();
}
