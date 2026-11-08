# Reviewing clips, and feeding the review back into the build

The review site is a dev tool for triaging every clip we have (live AI clips, real comparison clips and their pairs, and unbuilt candidates) and recording a decision per clip. The decisions are a committed file, so the feed build on the Mac can act on them.

## Run it

```bash
npm run review                          # http://0.0.0.0:8090 (reachable over the tailnet)
npm run review -- --port 8091 --host 127.0.0.1
```

It's a small Node server (`scripts/review/`). It isn't part of the app: Metro never bundles `scripts/`, nothing deploys it, and it refuses to start with `NODE_ENV=production`. It has no login, so only run it on a private network such as the tailnet.

### Where clips come from

All of these are merged into one list, with one item per clip key (`build_media.clip_id`: `x-<post id>`, `yt-<video id>`, `u-<url hash>`). Each item records every place it appears.

| Source | What | Config |
| --- | --- | --- |
| `prod` | the deployed Worker's `/feed?name=demo` and `compare` | `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_DEMO_PASSCODE` from `.env.local` |
| `local` | a `wrangler dev` Worker serving a local `build/` (`http://localhost:8787`) | `DEMO_PASSCODE` from `worker/.dev.vars` |
| batches | every `scripts/harvest/*.jsonl` (`spot_test`, `batch-*`, `real-*`) | none |
| notes | `scripts/annotate/notes.jsonl`, attached to X clips | none |

- A feed that doesn't exist yet (such as prod `compare` before it's deployed) or a Worker that's down shows as ✕ in the sidebar. Neither is fatal.
- Media comes from the first source that has the clip, prod before local.
- The local Worker's signed URLs are rewritten to the host the browser used, so they also play on a phone over the tailnet.
- Batch rows that were never built show as "Not built yet", with their evidence and source link.
- To change the sources or feeds, set `REVIEW_SOURCES=prod,local`, `REVIEW_FEEDS=demo,compare`, `REVIEW_LOCAL_URL` or `REVIEW_PROD_URL`.

### Organising the list

- **Group by:** feed or batch, status, AI vs real, label/tier, tells (has tells / no tells / not built), source platform, author, tag, pair, or duplicate hint.
- **Filters:** the sidebar has the same facets, with counts. Values within a facet are OR'd, and facets are AND'd. Search matches the key, author, title, evidence, note, tags and your feedback.
- **Sort:** feed order, newest, oldest, shortest, longest, or recently reviewed.
- The URL keeps the current view, so a link reopens the same filters and clip.
- **Pairs:** opening any clip in an AI↔real pair (`pairOf`) shows the AI clip next to all its real partners, playing together. "Review this one" switches between them.
- **Duplicate hints:** the site flags clips with the same file hash, the same evidence text, or a near-identical poster (a 64-bit difference hash). Clips in one pair are exempt, because they share a note on purpose.
- Deciding a clip doesn't drop it from the current list, so the next/previous order stays stable. Press **R** to re-apply the filters.

### Keys

| Key | Action |
| --- | --- |
| `J` `K` / arrows | next / previous clip |
| `Enter` `O` | open the clip; `Esc` goes back |
| `1` `2` `3` | keep / discard / needs work (press the same key again to clear; `0` also clears) |
| `T` | tag palette (then press the tag's number) |
| `N` | note (`Ctrl+Enter` or `Esc` saves) |
| `Space` | play / pause |
| `,` `.` | seek 1 s back / forward |
| `B` | tell boxes |
| `M` | mute |
| `U` | undo |
| `/` | search |
| `?` | help |

The quick tags live in `scripts/harvest/review/tags.json`. You can also edit them under ⚙ in the site.

## The decisions file

`scripts/harvest/review/decisions.jsonl` is an append-only log, with one event per change:

```json
{"v":1,"id":"<uuid>","at":"2026-11-07T…Z","by":"kenny","key":"x-2023151052800000040","set":{"status":"discard","tags":["low quality"],"note":"…"},"url":"https://x.com/i/status/…"}
{"v":1,"id":"<uuid>","at":"…","by":"kenny","key":"x-…","undo":"<id of a set event>"}
```

- **Folding:** the state of a clip is its set events folded in `(at, id)` order. Later fields win, an undo cancels its target, and `status: null` means unreviewed again.
- **Merging:** `.gitattributes` marks the file `merge=union`, so two branches that both add decisions merge without conflicts and fold the same way.
- **Two implementations:** `scripts/review/decisions.ts` and `review.py` both implement the fold. A shared fixture, `scripts/review/fixtures/`, keeps them in step.

To read the decisions from the terminal:

```bash
python3 -I scripts/harvest/review.py                         # counts per status
python3 -I scripts/harvest/review.py --status needs-work     # what to fix, with tags and notes
python3 -I scripts/harvest/review.py --status discard --json
python3 -I scripts/harvest/review.py --tag "wrong label"
```

## Mac-side workflow

1. **Review** on kenny-wsl, at the review site, then commit the decisions:
   ```bash
   git add scripts/harvest/review/ && git commit -m "chore(harvest): record clip review decisions"
   ```
2. **On the Mac**, pull, then rebuild with `--exclude-discarded`:
   ```bash
   git pull
   python3 -I scripts/harvest/review.py --status needs-work      # anything to fix by hand first
   python3 -I scripts/harvest/build_media.py <candidates>.jsonl --out build --merge --exclude-discarded
   python3 -I scripts/harvest/build_media.py scripts/harvest/real-<date>.jsonl --out build --feed compare --merge --exclude-discarded
   ```
   - `--exclude-discarded` leaves discarded clips out of both the new candidates and the kept feed (`--merge`). It reads `--decisions PATH` if you pass one.
   - In a pair feed (any `--feed` other than `demo`, such as `compare`), a discarded clip also takes its pair with it:
     - a discarded real clip drops out of its pair;
     - an AI clip whose real partners were all discarded drops out;
     - a discarded AI clip takes its real partners out of that feed.
   - In `demo`, only the discarded clip itself goes.
3. **Deploy** and check, as before:
   ```bash
   cd worker && npm run deploy && cd .. && npm run check:prod
   ```

Media for a dropped clip stays in R2 and `build/archive/`. Only the feed stops pointing at it, so un-discarding the clip (`U`, or a new `keep`) and rebuilding brings it back.
