import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroCandidates, rankClips, scoreClip, tellSummary, QUALITY_TIER_WIDTH, type RankableClip, type TellSummary } from './rank.ts';
import { DEMO_TELLS } from './demoQuality.ts';

const ai: RankableClip = { id: 'clip-0', sourceId: 'ai', verdict: 'ai', aspect: 9 / 16, duration: 12, verdictChecked: true };
const tells: TellSummary = { path: '', total: 3, boxed: 3, visual: 3, reviewed: 0 };
const sample = (id: string, patch: Partial<RankableClip> = {}): RankableClip => ({ ...ai, id, sourceId: id, ...patch });

test('quality rewards placed multi-step walkthroughs, phone aspect, short duration, visual and reviewed tells', () => {
  const score = (patch = {}, summary = tells) => scoreClip({ ...ai, ...patch }, summary);
  assert.ok(score() > score({}, { ...tells, boxed: 1 }));
  assert.ok(score({}, { ...tells, boxed: 5 }) > score({}, { ...tells, boxed: 7 }));
  assert.ok(score() > score({ aspect: 0.8 }));
  assert.ok(score() > score({ duration: 63 }));
  assert.ok(score() > score({}, { ...tells, visual: 0 }));
  assert.ok(score({}, { ...tells, reviewed: 3 }) > score());
  assert.ok(score() > score({ verdictChecked: false }));
  assert.ok(Number.isFinite(score({ duration: NaN })));
});

test('real clips use modest real engagement, length and shape bonuses; unknowns trail', () => {
  const real = sample('real', { verdict: 'real', sourceLikes: 10 });
  assert.ok(scoreClip(real) > scoreClip({ ...real, aspect: 16 / 9 }));
  assert.ok(scoreClip(real) > scoreClip({ ...real, duration: 90 }));
  assert.ok(scoreClip({ ...real, sourceLikes: 10000 }) > scoreClip(real));
  assert.ok(scoreClip({ ...real, verdictTier: 'real-verified' }) > scoreClip(real));
  assert.equal(scoreClip({ ...ai, sourceId: undefined }), -100);
});

test('summaries match signed Worker URLs and reject changed annotations', () => {
  const [id, summary] = Object.entries(DEMO_TELLS)[0];
  const clip = sample(id, { tellsUrl: `https://worker.test/m/${summary.path}?sig=secret&exp=123` });
  assert.deepEqual(tellSummary(clip), summary);
  assert.equal(tellSummary({ ...clip, tellsUrl: `${clip.tellsUrl?.split('?')[0]}.new` }), undefined);
  assert.equal(tellSummary({ ...clip, tellsUrl: undefined }), undefined);
});

test('same seed gives the same non-mutating tier shuffle; other seeds vary within tiers', () => {
  const clips = Array.from({ length: 32 }, (_, i) => sample(`a${i}`, { duration: i < 16 ? 12 : 90 }));
  const before = [...clips];
  const ranked = rankClips(clips, { seed: 1 });
  assert.deepEqual(ranked, rankClips(clips, { seed: 1 }));
  assert.notDeepEqual(ranked, rankClips(clips, { seed: 2 }));
  assert.deepEqual(clips, before);
  assert.equal(new Set(ranked).size, clips.length);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(Math.floor(scoreClip(ranked[i - 1]) / QUALITY_TIER_WIDTH) >= Math.floor(scoreClip(ranked[i]) / QUALITY_TIER_WIDTH));
  }
});

test('real/AI interleave is natural, bounded at two AI while real clips remain, and retains all clips', () => {
  const clips = [...Array.from({ length: 20 }, (_, i) => sample(`a${i}`)),
    ...Array.from({ length: 20 }, (_, i) => sample(`r${i}`, { verdict: 'real' })), sample('placeholder', { sourceId: undefined, verdict: undefined })];
  const ranked = rankClips(clips, { seed: 5 });
  let run = 0;
  for (const clip of ranked) {
    run = clip.verdict === 'ai' ? run + 1 : 0;
    assert.ok(run <= 2);
  }
  assert.equal(new Set(ranked).size, clips.length);
  assert.equal(ranked.at(-1)?.id, 'placeholder');
});

test('pins take precedence, ignore missing/duplicate ids, and Original restores the untouched list', () => {
  const clips = [sample('a'), sample('b', { duration: 90 }), sample('c', { verdict: 'real' })];
  assert.deepEqual(rankClips(clips, { pinnedFirst: ['b', 'missing', 'b', 'c'] }).slice(0, 2), [clips[1], clips[2]]);
  assert.deepEqual(rankClips(clips, { order: 'original', pinnedFirst: ['b'] }), clips);
  assert.deepEqual(rankClips([]), []);
});

test('hero excludes weaker tiers, retains original object references and honors explicit pins', () => {
  const clips = [sample('long', { duration: 90 }), sample('good'), sample('real', { verdict: 'real' })];
  assert.deepEqual(new Set(heroCandidates(clips, 48, { minimum: 0 })), new Set([clips[1], clips[2]]));
  assert.equal(heroCandidates(clips, 1, { pinnedFirst: ['long'] })[0], clips[0]);
  assert.deepEqual(heroCandidates([], 10), []);
});

test('published demo: komodo leads, editorial demotions remain below the preferred band', () => {
  const candidate = (id: string, duration: number, aspect = 9 / 16) => sample(id, {
    duration, aspect, tellsUrl: (DEMO_TELLS as Record<string, TellSummary>)[id].path,
  });
  const cat = candidate('x-2082309674960032067', 10.33);
  const room = candidate('x-2106432142217765020', 15.05);
  const lead = candidate('x-1996831827357847987', 11.59);
  const rescue = sample('x-1902265979444375861', { verdict: 'real' });
  const long = candidate('x-2025140310775366103', 63);
  const wide = candidate('x-1944501764553584892', 12, 1024 / 1280);
  assert.equal(tellSummary(cat)?.boxed, 4);
  assert.equal(tellSummary(room)?.boxed, 3);
  assert.ok(scoreClip(cat) > scoreClip(long));
  assert.ok(scoreClip(wide) - scoreClip(room) > QUALITY_TIER_WIDTH);
  assert.ok(scoreClip(rescue) < scoreClip(sample("ordinary-real", { verdict: "real" })));
  for (const seed of [0, 1, 42, 9876]) {
    const ranked = rankClips([cat, wide, long, room, lead], { seed });
    assert.equal(ranked[0], lead, 'komodo is pinned first across sessions');
    assert.ok(ranked.indexOf(cat) > ranked.indexOf(wide), 'cat remains in the lower ranked mix');
    const leads = heroCandidates([cat, wide, long, room, lead], 3, { seed, minimum: 0 });
    assert.equal(leads[0], lead);
    assert.ok(!leads.includes(cat) && !leads.includes(room), 'cat and room stay outside the preferred hero/showcase band');
  }
});

test('hero prefers the strict band, then fills to twelve distinct best-ranked candidates', () => {
  const best = sample('best', { verdict: 'real', duration: 12, sourceLikes: 10000 });
  const fillers = Array.from({ length: 20 }, (_, i) => sample(`f${i}`, { verdict: 'real', duration: i < 12 ? 25 : 90 }));
  const selected = heroCandidates([best, best, ...fillers], 48, { seed: 1 });
  assert.equal(selected[0], best);
  assert.equal(selected.length, 12);
  assert.equal(new Set(selected.map((c) => c.sourceId)).size, 12);
  assert.ok(selected.every((c) => c.duration! < 40));
});
