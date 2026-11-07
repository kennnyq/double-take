/**
 * Draft AI-video tells for demo clips with NVIDIA Nemotron and publish them.
 *
 *   NVIDIA_API_KEY_FILE=~/path/to/key node scripts/annotate/annotate.ts run <clipId…|--all> [--publish]
 *   node scripts/annotate/annotate.ts review <clipId> --reject <tellId> --why "…" [--by agent|human]
 *   node scripts/annotate/annotate.ts review <clipId> --check|--verify <tellId> --why "…" --by human
 *   node scripts/annotate/annotate.ts publish <clipId…>     publish an existing draft (with review decisions)
 *   node scripts/annotate/annotate.ts sync <clipId…|--all>  point the feed at scripts/harvest/tells/<id>.json
 *   node scripts/annotate/annotate.ts replay <clipId…|--all> re-validate saved replies (no API calls)
 *   node scripts/annotate/annotate.ts models                list models the key can call
 *
 * Options:
 *   --text-model <id>     claims step (default nvidia/nemotron-3.5-bolt-e4b)
 *   --vision-model <id>   boxes step (default nvidia/nemotron-3.5-super-vl-120b-a12b)
 *   --allow-model-only    also publish tells no note or comment claims (off: blind VLM finds were hallucinated in testing)
 *   --max-calls <n>       HTTP call cap for the run (default 40)
 *   --skip-existing       with --all: skip clips that already have a draft
 *
 * Work files (frames, raw replies, report.md, review.jpg) go to build/annotate/<clipId>/.
 * After publishing, `cd worker && npm run deploy` puts the feed live.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient, NimError } from './nim.ts';
import { annotateClip, publishClip, readFeed, recordReview, replayClient, syncToBuild, type Paths } from './pipeline.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const paths: Paths = {
  build: join(ROOT, 'build'),
  notes: join(ROOT, 'scripts/annotate/notes.jsonl'),
  curated: join(ROOT, 'scripts/harvest/tells'),
};

const argv = process.argv.slice(2);
const cmd = argv.shift();
const VALUE_FLAGS = ['--text-model', '--vision-model', '--max-calls', '--reject', '--check', '--verify', '--why', '--by'];
const flags = new Set(argv.filter((a) => a.startsWith('--') && !VALUE_FLAGS.includes(a)));
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valueArgs = new Set(VALUE_FLAGS.map(opt).filter(Boolean));
const ids = argv.filter((a) => !a.startsWith('--') && !valueArgs.has(a));

async function main() {
  if (cmd === 'models') {
    const client = createClient({ maxCalls: 1 });
    console.log((await client.models()).filter((m) => /nemotron|cosmos/.test(m)).join('\n'));
    return;
  }
  if (cmd === 'publish') {
    for (const id of ids) {
      const r = publishClip(paths, id);
      console.log(`${id}: ${r.tells.length} tell(s) → ${r.file ?? '(none)'}`);
      for (const d of r.dropped) console.log(`  dropped "${d.label}": ${d.reason}`);
      for (const p of r.reviewProblems) console.log(`  review: ${p}`);
    }
    return;
  }
  if (cmd === 'review') {
    const [id] = ids;
    const action = opt('--reject') ? 'reject' : opt('--check') ? 'spot_check' : opt('--verify') ? 'verify' : null;
    const tell = opt('--reject') ?? opt('--check') ?? opt('--verify');
    const by = opt('--by') === 'human' ? 'human' : 'agent';
    if (!id || !action || !tell) throw new Error('usage: review <clipId> --reject|--check|--verify <tellId> --why "…" [--by agent|human]');
    const all = recordReview(paths, id, { tell, action, by, why: opt('--why') ?? '' });
    console.log(`${id}: ${all.length} review decision(s); run \`publish ${id}\` to apply`);
    return;
  }
  if (cmd === 'sync') {
    const feed = readFeed(paths);
    const targets = flags.has('--all') ? feed.clips.map((c) => c.id) : ids;
    for (const id of targets) {
      if (!existsSync(join(paths.curated, `${id}.json`))) continue;
      console.log(`${id}: → ${syncToBuild(paths, id, join(paths.curated, `${id}.json`))}`);
    }
    return;
  }
  if (cmd === 'replay') {
    const feed = readFeed(paths);
    const targets = feed.clips.filter(
      (c) => (flags.has('--all') || ids.includes(c.id)) && existsSync(join(paths.build, 'annotate', c.id, 'run.json')),
    );
    for (const clip of targets) {
      const dir = join(paths.build, 'annotate', clip.id);
      const saved = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { provenance: { generatedAt: string } };
      const r = await annotateClip(replayClient(dir), paths, clip, { now: () => new Date(saved.provenance.generatedAt) }).catch((e: Error) => e);
      console.log(r instanceof Error ? `${clip.id}: FAILED ${r.message}` : `${clip.id}: ${r.status}, ${r.draft?.tells.length ?? 0} tell(s), ${r.draft?.unplaced.length ?? 0} unplaced`);
    }
    return;
  }
  if (cmd !== 'run') {
    console.error('usage: annotate.ts run <clipId…|--all> [--publish] | publish <clipId…> | models');
    process.exit(2);
  }
  const feed = readFeed(paths);
  let clips = flags.has('--all') ? feed.clips : feed.clips.filter((c) => ids.includes(c.id));
  const missing = ids.filter((id) => !feed.clips.some((c) => c.id === id));
  if (missing.length) throw new Error(`not in build/feeds/demo.json: ${missing.join(', ')}`);
  if (flags.has('--skip-existing')) clips = clips.filter((c) => !existsSync(join(paths.build, 'annotate', c.id, 'draft.json')));
  if (!clips.length) throw new Error('no clips selected');

  const client = createClient({ maxCalls: Number(opt('--max-calls') ?? 40) });
  const summary: string[] = [];
  for (const clip of clips) {
    try {
      const r = await annotateClip(client, paths, clip, {
        textModel: opt('--text-model'),
        visionModel: opt('--vision-model'),
        allowModelOnly: flags.has('--allow-model-only'),
        log: (m) => console.log(m),
      });
      let line = `${clip.id}: ${r.status}, ${r.draft?.tells.length ?? 0} tell(s)`;
      if (flags.has('--publish') && r.status === 'drafted') line += ` → published ${publishClip(paths, clip.id).file}`;
      summary.push(line);
    } catch (e) {
      summary.push(`${clip.id}: FAILED ${e instanceof Error ? e.message : e}`);
      // Out of credits or budget: stop instead of failing every remaining clip.
      if (e instanceof NimError && (e.status === 402 || /budget/.test(e.message))) break;
    }
  }
  console.log(`\n${summary.join('\n')}`);
  const calls = client.log;
  console.log(`${calls.length} API call(s), ${calls.filter((c) => c.status !== 200).length} not OK`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
