import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTellsFile } from '../../src/annotations/format.ts';
import { seekTimeFor, activeTells } from '../../src/annotations/walkthrough.ts';
import { pickTimes } from './media.ts';
import type { ChatRequest, NimClient } from './nim.ts';
import { annotateClip, publishClip, type Paths } from './pipeline.ts';

const CLIP = 'x-123';
const NOTE = 'This video is AI-generated. At 0:02 the red car turns into a bus on the right side of the road.';

/** A 4 s, 720x1280 clip with a 16:9 picture letterboxed in the middle (bars top and bottom). */
function fixture(): Paths {
  const root = mkdtempSync(join(tmpdir(), 'annotate-'));
  const media = join(root, 'build/media', CLIP, 'v1');
  mkdirSync(media, { recursive: true });
  mkdirSync(join(root, 'build/feeds'), { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x406:rate=30:duration=4',
    '-vf', 'pad=720:1280:0:437:black', '-pix_fmt', 'yuv420p', join(media, '720.mp4'),
  ]);
  writeFileSync(
    join(root, 'build/feeds/demo.json'),
    JSON.stringify({
      version: 1,
      clips: [{ id: CLIP, video: `media/${CLIP}/v1/720.mp4`, poster: `media/${CLIP}/v1/poster.jpg`, tells: null, width: 720, height: 1280, duration: 4, sha256: 'abc', source: { url: 'https://x.com/i/status/123' } }],
    }),
  );
  writeFileSync(
    join(root, 'notes.jsonl'),
    JSON.stringify({ tweetId: '123', noteId: '999', url: 'https://x.com/i/birdwatch/n/999', status: 'CURRENTLY_RATED_HELPFUL', snapshot: '2026-11-05', text: NOTE }) + '\n',
  );
  return { build: join(root, 'build'), notes: join(root, 'notes.jsonl'), curated: join(root, 'tells') };
}

function fakeClient(replies: unknown[]): NimClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    log: [],
    models: async () => [],
    chat: async (req) => {
      requests.push(req);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return { choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] };
    },
  };
}

const CLAIMS_REPLY = {
  rationale: 'note claims AI with a timed tell',
  stance: 'claims_ai',
  claims: [{ source_ref: 'note', quote: 'the red car turns into a bus', category: 'object_morph', description: 'car turns into a bus', time_s: 2, end_s: null, region_hint: 'right side of the road' }],
  comment_stances: [],
};

test('pickTimes brackets claimed moments and keeps them under the cap', () => {
  const t = pickTimes(10, [7], { spread: 8, max: 10 });
  for (const want of [5.5, 6, 6.5, 7, 7.5]) assert.ok(t.includes(want), `${want} in ${t}`);
  assert.ok(t.length <= 10);
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
  assert.ok(pickTimes(1, [5]).every((x) => x <= 0.95));
});

test('end to end offline: letterboxed clip → claims → frames → boxes on the full frame → published feed', async () => {
  const paths = fixture();
  // The model boxes the right half of the *cropped* picture it was shown.
  const client = fakeClient([
    CLAIMS_REPLY,
    '```json\n' + JSON.stringify({ tells: [{ claim_id: 'c1', category: 'object_morph', label: 'Car becomes a bus', explanation: 'The red car on the right is a bus a moment later.', frame: 3, t0: 2, t1: 2.5, bbox_2d: [500, 0, 1000, 1000], visible: 'yes', confidence: 'medium' }] }) + '\n```',
  ]);
  const run = await annotateClip(client, paths, JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8')).clips[0], {
    now: () => new Date('2026-11-07T08:00:00Z'),
  });
  assert.equal(run.status, 'drafted');

  // Requests: guided JSON, frames labelled with times, images actually attached, no thinking.
  const [claimsReq, draftReq] = client.requests;
  assert.ok(claimsReq.guided_json && draftReq.guided_json);
  assert.match(String(claimsReq.messages[1].content), /\[note\] \(Community Note\)/);
  const parts = draftReq.messages[1].content as { type: string; text?: string }[];
  const images = parts.filter((p) => p.type === 'image_url');
  const labels = parts.filter((p) => p.text?.startsWith('Frame '));
  assert.equal(images.length, labels.length);
  assert.ok(labels.some((l) => / at 2\.00s$/.test(l.text!)), 'frame at the claimed time');
  assert.deepEqual(draftReq.chat_template_kwargs, { enable_thinking: false });

  // Letterbox detected; frames sent cropped (16:9) and the box mapped back to the 9:16 frame.
  const frames = JSON.parse(readFileSync(join(run.dir, 'frames.json'), 'utf8'));
  assert.ok(frames.crop, 'letterbox crop detected');
  assert.ok(Math.abs(frames.crop.y - 437 / 1280) < 0.01);
  assert.ok(frames.frames[0].w > frames.frames[0].h, 'model saw the 16:9 picture, not the bars');
  const tell = run.draft!.tells[0];
  assert.ok(Math.abs(tell.box!.x - 0.5) < 1e-3);
  assert.ok(Math.abs(tell.box!.y - 437 / 1280) < 0.01);
  assert.ok(Math.abs(tell.box!.h - 406 / 1280) < 0.01);
  assert.equal(tell.review, 'unreviewed');
  assert.equal(tell.evidence?.url, 'https://x.com/i/birdwatch/n/999');
  assert.match(run.draft!.issues.join(), /code fence/);

  // Work products for review.
  for (const f of ['sources.json', 'claims.json', 'draft.json', 'report.md', 'review.jpg', 'run.json', 'draft.request.json']) {
    assert.ok(existsSync(join(run.dir, f)), f);
  }
  assert.doesNotMatch(readFileSync(join(run.dir, 'draft.request.json'), 'utf8'), /base64/);
  assert.match(readFileSync(join(run.dir, 'report.md'), 'utf8'), /Automatic draft/);

  // Publish: content-addressed file, feed points at it, app reader accepts it, walkthrough lands on the box.
  const pub = publishClip(paths, CLIP);
  assert.match(pub.file!, /^media\/x-123\/v1\/tells\.[0-9a-f]{12}\.json$/);
  const feed = JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8'));
  assert.equal(feed.clips[0].tells, pub.file);
  const served = readTellsFile(JSON.parse(readFileSync(join(paths.build, pub.file!), 'utf8')));
  assert.equal(served.version, 2);
  assert.equal(served.provenance?.note?.id, '999');
  assert.equal(served.tells.length, 1);
  const t = served.tells[0];
  assert.ok(activeTells(served.tells, seekTimeFor(t)).includes(t));
  // Publishing again with the same content is stable.
  assert.equal(publishClip(paths, CLIP).file, pub.file);
});

test('no concrete claims: stops before spending a vision call', async () => {
  const paths = fixture();
  const client = fakeClient([{ ...CLAIMS_REPLY, claims: [] }]);
  const clip = JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8')).clips[0];
  const run = await annotateClip(client, paths, clip);
  assert.equal(run.status, 'no_claims');
  assert.equal(client.requests.length, 1);
});

test('a malformed vision reply fails the clip loudly instead of publishing junk', async () => {
  const paths = fixture();
  const client = fakeClient([CLAIMS_REPLY, '{"tells": [{"label": "cut off mid']);
  const clip = JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8')).clips[0];
  await assert.rejects(annotateClip(client, paths, clip), /cut off/);
  assert.equal(JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8')).clips[0].tells, null);
});

test('publishing keeps hand-checked tells and drops overlapping drafts', async () => {
  const paths = fixture();
  mkdirSync(paths.curated, { recursive: true });
  writeFileSync(
    join(paths.curated, `${CLIP}.json`),
    JSON.stringify({ version: 1, tells: [{ id: 'human', category: 'object_morph', label: 'Checked by a person', t0: 1.5, t1: 2.5, box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 }, checked: 'frames' }] }),
  );
  const client = fakeClient([
    CLAIMS_REPLY,
    { tells: [{ claim_id: 'c1', category: 'object_morph', label: 'Car becomes a bus', explanation: 'x', frame: 3, t0: 2, t1: 2.5, bbox_2d: [500, 0, 1000, 1000], visible: 'yes', confidence: 'high' }] },
  ]);
  const clip = JSON.parse(readFileSync(join(paths.build, 'feeds/demo.json'), 'utf8')).clips[0];
  await annotateClip(client, paths, clip);
  const pub = publishClip(paths, CLIP);
  assert.deepEqual(pub.tells.map((t) => t.id), ['human']);
  assert.equal(pub.dropped.length, 1);
  assert.equal(pub.tells[0].review, 'spot_checked');
});
