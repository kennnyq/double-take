# Reviewing clips, and feeding the review back into the build

The review site is a dev tool for triaging every clip we have (live AI clips, real clips, and unbuilt candidates) and recording a decision per clip. The decisions are a committed file, so the feed build on the Mac can act on them.

## Run it

```bash
npm run review                                   # http://0.0.0.0:8090 (reachable over the tailnet)
REVIEW_PORT=8088 npm run review                  # another port
```

**One decisions log:** `scripts/harvest/review/decisions.jsonl`, committed in the repo. The site appends to it, in the checkout that runs the server; `build_media.py` reads it (`--only-kept`, `--exclude-discarded`); the harvest worker vets clips into it too. Commit it from the checkout that ran the server. Branches that each add decisions merge as a union (`.gitattributes`), so nothing is lost or duplicated.

On kenny-wsl, to see the local Worker's build (its passcode lives in another checkout):

```bash
REVIEW_PORT=8088 REVIEW_LOCAL_DEV_VARS=~/.t3/worktrees/double-take/feat-real-clips/worker/.dev.vars npm run review
```

- `REVIEW_LOCAL_DEV_VARS` reads the local Worker's `DEMO_PASSCODE` from that checkout. It's never printed or sent to the browser.
- Optional, `REVIEW_ALSO_DECISIONS=<path>[,<path>]`: fold another checkout's decisions log in **read-only**, to see decisions that aren't merged yet (for example a worker's vetting in progress). Events in both logs count once. It isn't needed once those decisions are on main.

It's a small Node server (`scripts/review/`). It isn't part of the app: Metro never bundles `scripts/`, nothing deploys it, and it refuses to start with `NODE_ENV=production`. It has no login, so only run it on a private network such as the tailnet.

### Where clips come from

All of these are merged into one list, with one item per clip key (`build_media.clip_id`: `x-<post id>`, `yt-<video id>`, `u-<url hash>`). Each item records every place it appears.

| Source | What | Config |
| --- | --- | --- |
| `prod` | the deployed Worker's `/feed?name=demo` and `compare` | `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_DEMO_PASSCODE` from `.env.local` |
| `local` | a `wrangler dev` Worker serving a local build (`http://localhost:8787`, also reachable at `kenny-wsl…:8787`); on kenny-wsl it serves the deploy candidate `~/Developer/double-take/build-next` (182 clips: 131 AI, 51 real) | `DEMO_PASSCODE` from `worker/.dev.vars` |
| batches | every `scripts/harvest/*.jsonl` (`spot_test`, `batch-*`, `real-*`) | none |
| notes | `scripts/annotate/notes.jsonl`, attached to X clips | none |

- A feed that doesn't exist (such as `compare`, which isn't shipped) or a Worker that's down shows as ✕ in the queue sheet. Neither is fatal.
- Media comes from the first source that has the clip, prod before local.
- The local Worker's signed URLs are rewritten to the host the browser used, so they also play on a phone over the tailnet.
- Batch rows that were never built show as "Not built yet", with their evidence and source link.
- To change the sources or feeds, set `REVIEW_SOURCES=prod,local`, `REVIEW_FEEDS=demo,compare`, `REVIEW_LOCAL_URL` or `REVIEW_PROD_URL`.

### The reviewer

One clip at a time, shown on a phone-shaped stage the way the app shows it.

- **Layout:**
  - In a wide window the stage takes the full height. The controls sit in a column beside it: the bar, the evidence (open by default, since it costs the video nothing there) and the dock.
  - On a phone the stage fills the width, with compact controls under it.
- **All clips (G):** a grid of every clip, from the grid button in the top bar.
  - **Group by:** decision, AI/real, batch or feed, who reviewed it (worker-vetted or a reviewer), tell count, or tell category. Tell counts load in the background from each clip's shipped run.
  - **Sort:** feed order, newest, oldest, longest, shortest, most tells, or recently reviewed.
  - **Filter:** chips for decision, AI/real, reviewer, tells, marks (★ picked tells, notes) and source, plus search over authors, titles, evidence and notes.
  - **Each cell:** the poster, playing a muted preview on hover; an AI/real badge; the decision; ★ picks; a ✎ when there's a note; the tell count and duration.
  - Click a cell to open it in the reviewer. The grid's order becomes the queue ("Clips grid (N)"), so J/K walk the same clips.
- **Placement:** boxes land where the app's double take puts them.
  - The video is always contained and scaled up to fill the stage while it plays, like `ClipItem`'s cover zoom.
  - The double take zooms it out to the whole frame (`contain`), so no box is cropped, and insets the stage with the app's `inspectInset`.
  - `scripts/review/web/placement.ts` uses the app's `videoRect`, `boxOnStage`, `fitFor` and `inspectInset`.
  - `placement.test.ts` fails if `ClipItem`/`TellOverlay` change those rules, and checks real portrait and landscape tells against them.
  - In the browser, `await reviewPlacementCheck()` (in the console) measures where each outline and the spotlight land against the video's own pixels. On 4 clips, portrait and landscape, playing and in the double take, the error is under half a pixel.

- **The app's own presentation:** the double take runs on the app's own modules: spotlight geometry and masks, info-card placement, eased scrubbing, step order, slow-motion replay windows and the palette.
  - The server serves those files type-stripped under `/app/` (`scripts/review/appModules.ts`), so the reviewer can't drift from the app.
  - `appModules.test.ts` fails if one of them starts importing something the browser can't load.
- **Live or Step (L):** the toggle by the clock.
  - **Live** (the default): while the clip plays, the selected run's annotations come up as their time does: the spotlight on the box and the card with the reason. They leave when the tell is over. One at a time; a boxed tell wins over one without.
  - **Step:** nothing shows during playback; annotations appear only in the double take.
- **Play / pause:** Space, a click or tap on the stage, or the button by the clock. A disc on the stage flashes the new state and stays up while the clip is paused. It stays hidden while the reviewer itself scrubs.
- **Annotation runs:** the switcher under the stage picks a run (`shipped` is the feed's own tells; `claude`, `nemotron-dense`… are the alternatives). The double take, the card text and the drawer follow the selected run.
- **Timeline:**
  - Each run has a lane, with every tell drawn over its window, so all runs' output can be compared at a glance.
  - Hover a marker to see its label.
  - Click a marker to open that tell in the double take; it scrubs there.
  - Click the track to ease to that time, or drag to scrub directly.
- **All tells (T):** every annotation from every run for this clip, by time or by run.
  - Open it from the "All tells" chip by the run switcher, or the link in the drawer's "Your marks".
  - Each cell has the frame at the tell's focus time with its box spotlighted, the run, the time, and the tell's label and reason.
  - ★ picks a tell as a good one; the field beside it takes a short note on that tell.
  - Click a frame or label to jump the player there, in the double take.
  - **P** picks the tell on screen (live or in the double take) without opening the grid.
  - Picks and notes show on the card ("★ Picked" and the note), as a ring on the tell's timeline marker, and in the drawer.
- **Outlines (B):** every run's boxes over the video while they apply. The selected run is solid and labelled; the others are dashed.
- **Evidence drawer (E):** author and stats, label/tier, sources, the Community Note, the subreddit consensus, the batch evidence, each run's model and date, unplaced claims, any earlier decision, and, for the older clips from the first real batch, the AI↔real partner (pairs aren't a goal any more, and `compare` isn't shipped).
- **Decisions:** Keep or Drop, with an optional note. A note on its own saves when the field loses focus.
  - Deciding moves on to the next clip.
  - **U** undoes, step by step.
  - The note field only ever holds your own note. Another reviewer's note stays in the drawer and is never overwritten by yours.
- **Queue (F):**
  - Unreviewed (the default: no keep or drop yet), Kept, Dropped or All.
  - Worker-vetted or not: a live decision `by: worker-vetted`, or the `worker-vetted` tag.
  - With or without tells.
  - Any one feed or batch.
  - Optionally clips that were never built.
  - Clips with tells come first, then feed and batch order.
  - The filter is remembered, and the URL holds the current clip.
- **Motion:** only moving between clips cuts. Everything else is continuous:
  - the video position always scrubs;
  - the spotlight eases between areas;
  - cards, the drawer and sheets fade and slide.
- **Phone:** the same layout stacks. Swipe up or down on the stage for the next or previous clip, tap to play or pause (or for the next step), and double-tap for the double take.

### Keys

| Key | Action |
| --- | --- |
| `J` `K` / `↓` `↑` | next / previous clip |
| `←` `→` | previous / next annotation (opens the double take) |
| `Space` | play / pause; the next step during a double take |
| `D` / `Enter` | double take on / off |
| `1`–`9`, `V` | pick / cycle the annotation run |
| `B` | outline every run's boxes |
| `L` | annotations live while playing / only when stepping |
| `G` | all clips: the clip grid |
| `T` | all tells: this clip's annotations from every run |
| `P` | pick (★) the annotation on screen |
| `A` / `X` | keep / drop (again to clear) |
| `N` | note |
| `U` | undo |
| `E` | evidence drawer |
| `F` | queue filters |
| `M` | sound |
| `Esc` | close / leave the double take |
| `?` | shortcuts |

## The decisions file

`scripts/harvest/review/decisions.jsonl` is an append-only log, with one event per change:

```json
{"v":1,"id":"<uuid>","at":"2026-11-07T…Z","by":"kenny","key":"x-2023151052800000040","set":{"status":"discard","tags":["low quality"],"note":"…"},"url":"https://x.com/i/status/…"}
{"v":1,"id":"<uuid>","at":"…","by":"kenny","key":"x-…","undo":"<id of a set event>"}
```

- **Annotation marks:** a set event can carry `tells`, the reviewer's marks on single annotations, keyed `<run>/<tell id>`:
  ```json
  {"v":1,"id":"<uuid>","at":"…","by":"kenny","key":"x-…","set":{"tells":{"claude/wallpaper-pattern-switches":{"pick":true,"note":"clearest one"}}}}
  ```
  - Each mark merges into what's there, and `null` clears it.
  - A mark never changes a clip's status, so `build_media.py` (which reads only `status`) ignores marks.
  - Older readers skip the field.
- **Folding:** the state of a clip is its set events folded in `(at, id)` order. Later fields win, an undo cancels its target, and `status: null` means unreviewed again.
- **Merging:** `.gitattributes` marks the file `merge=union`, so two branches that both add decisions merge without conflicts and fold the same way.
- **Two implementations:** `scripts/review/decisions.ts` and `review.py` both implement the fold. A shared fixture, `scripts/review/fixtures/`, keeps them in step.

To read the decisions from the terminal:

```bash
python3 -I scripts/harvest/review.py                         # counts per status
python3 -I scripts/harvest/review.py --status needs-work     # what to fix, with tags and notes
python3 -I scripts/harvest/review.py --status discard --json
python3 -I scripts/harvest/review.py --tag "wrong label"
python3 -I scripts/harvest/review.py --picks                  # picked annotations and tell notes (--json for one per line)
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
   python3 -I scripts/harvest/build_media.py <candidates>.jsonl --out build --merge --only-kept --exclude-discarded
   ```
   - `--only-kept` builds only the new candidates marked keep, so a partly reviewed batch never ships its unreviewed clips. Rows already in the feed stay.
   - `--exclude-discarded` leaves discarded clips out of both the new candidates and the kept feed (`--merge`). Both read `--decisions PATH` if you pass one.
   - The `compare` feed isn't shipped (real clips stand alone in `demo`). If a pair feed is ever built (any `--feed` other than `demo`), a discarded clip also takes its pair with it:
     - a discarded real clip drops out of its pair;
     - an AI clip whose real partners were all discarded drops out;
     - a discarded AI clip takes its real partners out of that feed.
   - In `demo`, only the discarded clip itself goes.
3. **Deploy** and check, as before:
   ```bash
   cd worker && npm run deploy && cd .. && npm run check:prod
   ```

Media for a dropped clip stays in R2 and `build/archive/`. Only the feed stops pointing at it, so un-discarding the clip (`U`, or a new `keep`) and rebuilding brings it back.
