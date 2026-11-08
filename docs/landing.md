# Web landing page

On the web the app opens on a landing page (`src/landing/`); the iOS app opens straight on
the feed. A gallery of the feed's portrait clips plays behind the hero; below it, a
scroll-driven tour of the app's features on a pinned phone ends in a last call to action
and the footer.

## The launch

The hero's button (or any clip, or the last call to action) starts the launch (`launch.ts`):

1. The gallery slows to a stop, and the words and everything below fade.
2. The other clips leave one by one until one is left.
3. That one grows onto the feed's own video: the 9:16 card on desktop, the full screen on a phone. The feed is mounted beneath, already on that clip.
4. The feed takes over with the sound on (the press counts as the browser's required gesture), while the app's rail, actions and tab bar come in around it.

After the launch the address gets `#app`, so a reload stays in the app, and Back returns to
the landing. Open `/#app` to skip it.

## The gallery

- **Media.** Every tile plays at once from one looping video, the gallery atlas in `public/gallery-atlas/` (48 of the feed's portrait clips, never the same footage twice and picked for variety, as 144×256 cells, 15 fps, about 4 MB). The gallery shows the atlas's clips that the live feed still has, drawn a strip at a time onto canvases under the tiles; it streams endlessly through Media Source, so it never visibly loops.
- **Reels.** As each tile's clip comes to its end, it scrolls to its next clip like a reel (the old one slides up, the next comes in from below at its first frame, in ~0.4 s), picking a clip that no tile within two rows or columns, or within two places along its own strip, shows (rows take three sets of clips in turn, so neighbours never share one). `?reels=off` lets clips loop instead. `?busy=calm|medium|lively` sets how busy the wall is: how long a tile keeps a clip, how many turns start a second, and how far apart (medium by default).
- **Launch timing.** `?start=600|1000|1400|2000|2500|3000` sets when the picked clip starts forward (ms; 1400 by default), `?growth=fast|medium|slow` how quickly it grows, and `?fade=slow|slower|slowest` how long the rest of the wall takes to fade out from the press (2.6, 3.4 or 4.4 s, an ease-out; `slower` by default). The fade is its opacity only, so nothing in it moves any differently; the picked clip is lifted out at the press, looking as it did under the shade, and the shade stays over the rest until it has nearly faded, so the wall never brightens. The app's pieces come in over the fade's tail. The clip grows on the compositor (its transform; its clip and rounding follow), so a busy main thread can't stall it.
- **Lighter for phones.** Phones and slow machines get a lighter landing with the same look (no backdrop blur, tiles sinking back along the plane one by one at the launch, drawn flat, fewer turns, each a soft crossfade rather than a swipe: `?turn=` forces either); `?tier=` forces `full` or `phone`.
- **Regenerating the atlas.** Do it when clips leave the feed or new ones should join: `python3 -I scripts/harvest/build_atlas.py --out build`, then copy the new `build/media/atlas/<hash>/atlas.{mp4,jpg,json}` into `public/gallery-atlas/`. The manifest also carries how alike each pair of clips looks (`build_atlas.py --annotate public/gallery-atlas` adds that to an atlas without re-encoding it); the landing uses it to keep the same footage and look-alikes apart, both when it lays the tiles out and when a tile swipes to its next clip. Without an atlas, tiles play each clip's `tile.mp4`, or show posters.

## The features tour

`src/landing/features/`: a phone pinned to the screen while the page scrolls through
Scroll (the double take walkthrough), Upload, Game, Skills and Profile. The scroll drives
every motion through one frame loop that runs only while the section is on screen, so it can
be scrubbed both ways. Game and Skills draw the game's own `ScorePill` and `SkillsView` with
demo data (`features/mock.ts`). The old sections below the hero (How it works, the tells, Try
one) are hidden by default and kept behind the Hero tab's "Old sections below the hero".

## Designs on trial (development only)

A dark design bar bottom-right steps through whole designs with ‹ › (or `[` `]`); its name
opens every axis to mix, and ↺ replays the landing. Tabs along its bottom switch between the
**Hero**, the **Features** tour and **Global** aids (jump to a section, a frame time meter).

- **Hero** (`designs.ts`): ~25 axes (gallery, blur, shade, words, type, key word, button, what's below, and every beat of the launch) and 12 whole designs. `?design=<id>` picks a design and `?<axis>=<value>` overrides one.
- **Features** (`features/designs.ts`): `?fdesign=stage|side|rail` (center stage by default), and f-prefixed knobs such as `?fcta=wall|quiz|phone|score|plain` (the last call to action), `?fcard=rest|side|lift|out` (where the walkthrough card sits), `?flength=`, `?ffollow=`, `?ftilt=`, `?fsteps=`, and per-section toggles (`?fscroll=off`, …).
- **Global:** `?fmeter=on` shows frame times.

A copied link reproduces what you see. Without parameters, the last design you looked at comes
back, or else the defaults (Tilted plane for the hero). Production always shows the defaults
and never reads the address or storage; add `?dev` to get the bar.
