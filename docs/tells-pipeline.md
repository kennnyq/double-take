# AI tells pipeline

Each feed clip can carry a tells file (`scripts/harvest/tells/<clipId>.json`): timed moments
with a box on the frame, a short explanation, the claim it came from and how far anyone has
checked it. The double take walks through them.

## The walkthrough

- Each step loops a short stretch around the tell in slow motion (0.35×, muted), because a paused frame hides morphing, vanishing and sliding.
- The box appears only while the tell applies, and the card shows just the reason.
- Arrows (or Space) go on and back; the video scrubs between moments, never jumps.
- Unchecked drafts can be marked **AI draft** for reviewers (Dev settings → Mark model drafts; off by default).

## Drafting tells

The pipeline in `scripts/annotate/` drafts tells from a clip's Community Note
(`scripts/annotate/notes.jsonl`) and any saved replies:

1. **Claims.** A text model (`nvidia/nemotron-3.5-bolt-e4b`) splits the note into one claim per artifact. Each must quote the source word for word, and the quote is checked against the source text.
2. **Boxes.** A vision model (`nvidia/nemotron-3.5-super-vl-120b-a12b`) sees labelled frames bracketing each claim's time. It boxes the claim on the frame where it shows and names a later frame for "after". Letterbox bars are cropped off first and mapped back.
3. **Checks.** Two deterministic checks run on the result:
   - A pixel check measures whether the boxed region really changes. A wrong "after" frame is moved, and a spot that never changes is marked unsure.
   - Scene cuts (ffmpeg scene score ≥ 0.5) keep each tell inside its camera shot, because across a cut the same spot shows something else.
4. **Review.** `build/annotate/<clipId>/review.jpg` draws every box on the full frame, the same way the app places it. Agents may only reject a tell. Marking one checked or verified needs `--by human`.
5. **Publish.** Content-addressed files (`tells.<hash>.json`) are written next to the media, so cached media URLs never serve stale tells. Then deploy the Worker (`cd worker && npm run deploy`).

```bash
node scripts/annotate/annotate.ts run <clipId> --publish
node scripts/annotate/annotate.ts replay --all   # re-validate saved model replies, no API calls
```

Model output is treated as unverified evidence:

- Claims that couldn't be placed on the video go on a closing **Also noted** card rather than being dropped or invented.
- Tells the model finds without a note or comment behind them are dropped unless you pass `--allow-model-only`.

## NVIDIA key

Put `NVIDIA_API_KEY=nvapi-…` in `scripts/annotate/.env.local`. Keep it out of the repo root:
in development, Expo bundles every root file whose name starts with `.env` into the web app.

- The file is gitignored, and outside the root Expo never bundles it.
- Worktrees find the main checkout's copy automatically. `npm run worktree:env` copies it, plus `.env.local` and the Worker's `.dev.vars`/`.prod.vars`, into a new worktree.
- `npm run key:check` lists the models the key can call; it costs one free API call.
- `NVIDIA_API_KEY` or `NVIDIA_API_KEY_FILE` in the environment still take precedence.

## Testing changes

```bash
npm run check        # typecheck, lint, app + pipeline tests, Worker tests (offline)
npm run check:prod   # end-to-end tests against the deployed Worker (needs worker/.prod.vars; BASE_URL overrides the URL)
npx expo start       # then open any clip with tells and hold or double tap it
```

In the app, check that:

- each step loops in slow motion with the box on the named spot;
- the arrows go on and back, and the last step's check closes it;
- the model switcher (Dev settings → Model, dev builds only) flips between `main`, `claude` and `nemotron-dense`.

The bathroom clip (14th in the feed) has three steps in `main` and four in `claude`.

## Comparing pipelines

A clip can carry alternative tells files next to the main one (feed `tellsAlt.<name>`,
records in `scripts/annotate/variants/<name>/`). Dev builds can switch between them (Dev
settings → Model, or the cloud default `tells_pipeline`). Release builds use the main file.

| Variant | What it is |
| --- | --- |
| `main` | Nemotron, merged with hand-checked tells (checked ones always win) |
| `nemotron-dense` | Nemotron given quarter-second frame runs around each claim (`--dense`) |
| `claude` | The same two prompts answered by a Claude agent (`--engine agent --dense`); no API calls |

```bash
# Nemotron variant
node scripts/annotate/annotate.ts run <clipId…> --variant nemotron-dense --dense --publish
# Agent variant: each run stops at the next missing reply and prints the request to read
# and the reply file to write (build/annotate/<id>/claude/{claims,draft}.reply.json).
# The agent views gridded frames (0–1000 labels) and its replies go through the same validation.
node scripts/annotate/annotate.ts run <clipId…> --engine agent --dense
node scripts/annotate/annotate.ts publish <clipId…> --variant claude
```
