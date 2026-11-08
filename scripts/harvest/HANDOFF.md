# Handoff: harvesting AI videos, and real ones to compare them with

For an agent picking up the clip-harvesting work. Read the repo `README.md` (tells pipeline) and `worker/README.md` (serving) first; this file covers what they don't.

## Where things stand (2026-11-07)

- The live feed (`build/feeds/demo.json`, served at `/feed`) has **119 clips**, all labelled `confirmed` AI. 80 of them have tells. `build/` lives on Kenny's Mac only.
- AI candidate batches live in this folder: `spot_test.jsonl`, `batch-2026-11-07*.jsonl`. Each row carries the Community Note that flagged the clip.
- **Real clips:** the first batch is `real-2026-11-07.jsonl` (18 real clips plus the 10 AI clips they pair with), and the curation log is `real-2026-11-07.md`. It's built into `feeds/compare.json` and is ready to merge into `demo.json`; see "Shipping real clips" below. It is not deployed yet.
- `scripts/annotate/notes.jsonl` holds the notes the tells pipeline reads. It's for AI clips only: real clips' notes stay in their batch rows, so the tells pipeline never drafts "AI tells" from a "this is not AI" note.
- Every AI clip so far comes from X Community Notes. YouTube comment mining was tried in the spot test and was much noisier; Reddit needs OAuth and was never set up.

## Tools

`yt-dlp`, `ffmpeg` and Python 3.11+. YouTube also needs a JS runtime for yt-dlp: install `deno` (`brew install deno` on the Mac; on Linux, the deno.land install script into `~/.deno`). Without it, YouTube metadata still works, but downloads fail or miss formats, and most real clips come from YouTube.

## The AI-video workflow

```bash
# 1. Dumps (≈530 MB + 190 MB). Use the latest date that exists, usually 1-2 days ago.
#    Save them in a scratch folder, never the repo.
D=2026/11/05
curl -fO https://ton.twimg.com/birdwatch-public-data/$D/notes/notes-00000.zip
curl -fO https://ton.twimg.com/birdwatch-public-data/$D/noteStatusHistory/noteStatusHistory-00000.zip

# 2. Rank helpful AI-video notes, skipping clips we already have.
python3 -I scripts/harvest/pick_notes.py notes-00000.zip noteStatusHistory-00000.zip ranked.jsonl \
  --exclude scripts/harvest/spot_test.jsonl --exclude scripts/harvest/batch-2026-11-07.jsonl \
  --exclude scripts/harvest/batch-2026-11-07b.jsonl --exclude scripts/harvest/batch-2026-11-07c.jsonl

# 3. Probe them in rank order; keep live, 3–90 s, non-repost videos (stops after 80 keepers).
python3 -I scripts/harvest/resolve.py ranked.jsonl live.jsonl 80

# 4. Curate by hand (rules below), then save the keepers as the next batch file.
#    Keep them in build_media's candidate shape: {source, url, label, evidence}.
#    Append each keeper's `note` object to scripts/annotate/notes.jsonl.

# 5. Download, normalise, merge into the feed (existing clips are kept).
python3 -I scripts/harvest/build_media.py scripts/harvest/batch-<date>.jsonl --out build --merge --jobs 4

# 6. Tells (needs .env.nvidia.local), then deploy and test.
node scripts/annotate/annotate.ts run <clipId…> --publish
cd worker && npm run deploy && cd .. && npm run check:prod
```

`resolve.py` asks yt-dlp for metadata only (`-J`, no download). It drops posts that are gone, image-only or multi-video, and videos outside `--min`/`--max` (3–90 s), and it dedupes on the media id (X thumbnails carry it; every repost shares it). Kept rows gain a `probe` object: duration, size, uploader, title, upload date and media id.

### Curation rules

Drop:
- notes that say the video is *real*. They match the AI regex because they mention AI;
- clips that mix real and AI footage;
- deepfakes of real, named people, and political, war or propaganda clips. The demo stays on harmless genres: animals, weather, stunts, food, "satisfying".
- sexual content and anything involving minors. `pick_notes.py` already skips the obvious notes; still check the video itself.

Expect roughly half of what you probe to be gone: deleted posts, suspended accounts or no video. Last AI run: 50 kept out of 94 probed.

### Gotchas

- **The scratchpad gets wiped.** Re-download the dumps rather than hunting for an old copy.
- **Reposts.** yt-dlp gives every repost of an X video the same media id, and `resolve.py` dedupes on it. `build_media.py` also collapses byte-identical files. Neither catches a re-encoded repost, so glance at the posters of new clips next to old ones.
- **Size limit.** Workers Static Assets caps each file at 25 MiB. 90 s at the current encode is about 22 MB. Don't raise `--max-duration` without lowering the bitrate. For a long source (a livestream, a compilation), cut it with a `section` instead (below).
- **No R2 and no card.** The Worker serves from static assets on the Free plan on purpose. Don't enable R2 or anything billable.
- **Labels reach the app as verdicts.** `src/data/remote.ts` maps `label` to `Clip.verdict` (`verdictFromLabel`: `confirmed`/`ai` → AI, `real`/`not_ai`/`authentic` → real), and `tier`/`evidence` to `Clip.verdictTier`/`verdictEvidence`; `verdictWhy(clip)` turns them into one line for the reveal. Feed modes: Default (reveal), Auto label ("AI" / "Not AI" on every clip), Only AI, Only real. The reveal opens only on clips with tells, so real clips show their verdict through Auto label for now.
- **Tells files are content-addressed** (`tells.<sha12>.json`). Edit the source in `scripts/harvest/tells/` and rebuild; never overwrite a published file.

## Real videos for comparison

Goal, confirmed by the first batch: for an AI clip, find **real footage of the same kind of thing** (a real llama pushing into a car next to the AI alpaca spitting on a windshield), and keep a pool of **real clips people mistook for AI**. Both give the app honest negatives, and the first gives side-by-side pairs.

### The real-clip workflow

```bash
# 1. Same dumps as above. Negatives ("not AI" notes) and note-linked pairs, harmless genres only.
python3 -I scripts/harvest/pick_real.py notes-00000.zip noteStatusHistory-00000.zip real_ranked.jsonl \
  --exclude scripts/harvest/real-2026-11-07.jsonl \
  $(for f in scripts/harvest/{spot_test,batch-*}.jsonl; do echo --ai $f; done)
python3 -I scripts/harvest/resolve.py real_ranked.jsonl real_live.jsonl --max 1800   # long sources get a section later

# 2. Lookalikes for AI clips without a note link. Rows need `url`; add `query` (3-6 words)
#    where the post's title is empty or vague, or pass --query x-<id>="mountain goat climbing cliff".
python3 -I scripts/harvest/search_real.py ai_pick.jsonl lookalikes.jsonl --per-clip 3 --hits 12

# 3. Look at every candidate (frame sheets: see real-2026-11-07.md), curate, and write the batch:
#    each AI clip's row ({source, url, label: "confirmed", evidence}) followed by its real rows.
# 4. Build the compare feed. AI clips already in demo are reused, never re-encoded.
python3 -I scripts/harvest/build_media.py scripts/harvest/real-<date>.jsonl --out build --feed compare --jobs 4
```

- **`pick_real.py`** writes `negative` rows (the noted post is real: tier `real-verified`, or `not-ai-cgi` for CGI, animation and games) and `pair` rows (`url` is the linked footage, with `pairOf: x-<ai post>`, `realUrl` and `how: "note-link"`). `--ai` puts pairs whose AI clip we already have first. Notes on politics, war, news, named public figures, sexual content, minors, films, music videos and ads are dropped unless `--all-genres`.
- **`search_real.py`** builds a subject query (a keyword heuristic for now: subject nouns from the post, then the note, then the post's other words), runs `ytsearchN`, probes each hit, and keeps 3–90 s uploads from before 2023 (`real-prior`) or from a licensing channel (`real-agency`: ViralHog, Storyful, Newsflare, Jukin/FailArmy, Caters, RingTV and similar). It drops titles that mention AI, CGI, animation or off-genre subjects, and ranks by query/title word overlap.
- **`build_media.py`** takes `--feed NAME` (writes `feeds/NAME.json`) and carries `tier`, `pairOf` and `how` into feed rows. A clip already built for another feed under `--out` is reused, with the new candidate's label, evidence and comparison fields. A candidate `section: "MM:SS-MM:SS"` cuts a long source to that stretch before anything else (the Tesla launch stream: `16:12-16:44`).
- `python3 -I scripts/harvest/test_harvest.py` (also part of `npm test`) covers the classifier on real note texts, the genre filter, links, subject queries, the probe filter, tier labels and every committed `real-*.jsonl`.

### Labels

`label` is what the app turns into a verdict; `tier` says how we know, and `evidence` explains it the same way it does for AI clips:

| Tier | Meaning | `label` |
| --- | --- | --- |
| `real-verified` | A helpful note or fact-check says it's real, or the note links it as the real footage | `real` |
| `real-prior` | Uploaded before 2023, before realistic text-to-video | `real` |
| `real-agency` | From a licensing channel that verifies footage | `real` |
| `not-ai-cgi` | CGI, animation or a game: not AI, but not footage either | `not-ai-cgi` (unknown in the app; kept out of the feed) |

So `verdictFromLabel` already understands every shipped label, and nothing there needs extending. `LABEL_FOR_TIER` in `pick_real.py` is the single source of the mapping.

### What the sources yielded (2026-11-05 dump)

| Source | Raw | After filters | Probed live | Kept by eye |
| --- | --- | --- | --- | --- |
| "Not AI" notes | 72 helpful | 31 harmless-genre (+9 CGI) | 14 shortlisted, **5 live** | 4 |
| AI notes linking the real footage | 317 regex hits, 277 by the handoff's count | 59 after requiring "the/a/here's original footage" and dropping self-links | 9 shortlisted, 7 live | 3 (1 pairs with a clip in our feed) |
| Subject search (`ytsearch12`) | 12 AI clips queried | 25 pre-2023 hits kept | all live | 11 for 10 AI clips |

Lessons:
- **Subject search is the pair engine.** 10 of 12 queries found usable pre-2023 footage: National Geographic, BBC, The Telegraph, SCMP and home videos from 2009–2021. About 1.6 s per search and 3–5 s per probe; 12 clips took about 10 minutes.
- **Note-linked pairs are rare and mostly not footage.** Most links point at the AI creator's own upload (Instagram or TikTok "AI" accounts), a deepfake's source (named people, politics) or a long livestream. Only the Tesla Roadster note linked real footage for a clip already in our feed.
- **"Not AI" clips decay fast.** 9 of the 14 shortlisted posts were already deleted. The survivors are good "people thought this was Sora" clips (a car subwoofer close-up, a kitchen dance, the SpaceX splashdown on a TV, a pool "creature" on a fishing line).
- **Search results still need eyes.** Seen while curating: a Simpsons clip under a t-shirt cannon title, a film scene under "kangaroo at airport", kids or babies in frame, news segments with anchors or injuries, and a 4-minute compilation behind one note's "actual video" link.
- **Pre-2023 is a strong, cheap filter.** Agency channels didn't come up for these queries; the date did all the work.

### Shipping real clips

The Worker already serves `/feed?name=compare`; `npm run check:prod` now checks it (it needs `compare.json` deployed), along with 404/400 for unknown or bad feed names.

Recommendation: **merge real clips into `demo`, and also publish `compare`.**
- `demo` is what the app shows, and Auto label and **Only real** work from `label`. Real clips in a separate feed would be invisible to those modes.
- `compare` (each AI clip followed by its real counterparts) is the input for a future side-by-side or "AI or real?" round, and can be deployed any time; the app doesn't read it yet.

On the Mac, from the repo root with `build/` in place:

```bash
brew install deno                       # yt-dlp needs it for YouTube downloads
python3 -I scripts/harvest/build_media.py scripts/harvest/real-2026-11-07.jsonl --out build --feed compare --jobs 4
python3 -I scripts/harvest/build_media.py scripts/harvest/real-2026-11-07.jsonl --out build --merge --jobs 4   # demo: adds the 18 real clips
cd worker && npm run deploy && cd .. && npm run check:prod
```

The second build reuses everything the first one downloaded. AI partners already in `demo` are never re-encoded.

### Next

1. **A reveal for clips without tells.** The data is there (`verdictWhy`); the hold/double-tap reveal still needs a path that doesn't go through `TellOverlay`, on phone and desktop, to show the "Not AI" verdict with that line.
2. **Model queries.** Swap `subject_query` for the Nemotron text model (the hosted one the tells pipeline uses; nothing runs locally yet). The heuristic is fine for titled posts, but about a third of AI posts have only a t.co link for a title.
3. **Poster similarity** on the 4080 (a CLIP-style embedding of the AI poster against each hit's thumbnail) to rank lookalikes when titles tie.
4. More pairs: the clips in `ai_titles` with clear subjects (wildlife, weather, food) that weren't searched yet.
