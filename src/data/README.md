# Demo order

`loadInitialClips()` is the shared session cache for phone/desktop Home, Game and
landing. It applies Best first once and renumbers positional `clip-N` ids only
there. A dev setting under Interaction → Feed switches to Original on reload.
Original restores the former behavior (including optional experimental engagement
ranking); Best first takes precedence over that ranker and untimed adaptive deals.
Timed/adaptive rounds retain their existing dealing policy.

Pure API in `rank.ts`:

- `scoreClip(clip)` scores quality, using published annotation summaries when their
  revision matches. `tellSummary(clip)` exposes the matched summary.
- `rankClips(clips, { seed?, pinnedFirst?, order? })` returns the same objects in
  demo order. Its default seed is created once per app session. Quality tiers are
  12 points wide; shuffling cannot cross a tier within the same verdict. One or
  two AI clips precede each real clip while both pools have clips.
- `heroCandidates(clips, limit?, options?)` shortlists within 12 points of the
  strongest available clip of each verdict, then fills to twelve distinct clips
  from the next-best ranks for variety. Use `{ minimum: 0 }` for the strict
  walkthrough shortlist. Filter for eligible atlas cells or
  AI walkthroughs before calling. This deliberately favors quality even when the
  feed's Original option is selected.
- Edit `DEMO_PINNED_FIRST` to force source ids first. The default pins the room
  clip, `x-2106432142217765020`. Pins take precedence over interleaving;
  missing/duplicate ids are ignored. Kenny's editorial preference subtracts
  48 points from the opera-glove cat (`x-2082309674960032067`), keeping it in
  the regular mix below the demo leads and outside the preferred hero band.

AI scoring: phone aspect (h/w ≥ 1.6) +36, other portrait +12; 8–20 seconds +20,
shorter +10, 20–30 +8, over 40 −35; +10 per usable boxed tell up to five, +10
for 3–5, −2 per excess box; visual kinds up to +10, reviewed tells up to +14,
confirmed AI label +8. Real clips use the same shape/length points, up to +8 for
source likes (a modest engagement proxy) and +8 for verified/prior/agency provenance.
Popularity counts synthesized for the action rail never influence ranking.

`demoQuality.ts` is generated from the **published main tells**, not alternate
models or unchecked drafts on disk. It records boxes, categories and review state,
without downloading annotation files at app startup. A changed tells URL revision
invalidates that clip's summary; unknown/new clips still score by live shape,
duration and provenance. Refresh after publishing annotations:

```sh
node scripts/data/demo-quality.ts /path/to/build/feeds/demo.json /path/to/build
```

The landing atlas keeps its existing cells/decoder, but uses only the shared
shortlist among cells it actually contains, with twelve distinct candidates and
three disjoint strip groups so neighboring rows/columns do not repeat a clip. The walkthrough showcase chooses from
the full AI shortlist, validates its tells at runtime, and can use clips absent
from the atlas. Game preserves the shared order within fresh/recent groups while
keeping balanced deals, deduplication and lazy media checks.

For a reproducible top-ten report (the live app uses its own session seed):

```sh
node scripts/data/demo-order.ts /path/to/build/feeds/demo.json 20261108
```
