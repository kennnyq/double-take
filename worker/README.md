# double-take-api

Cloudflare Worker that serves the demo feed and media. Live at
`https://double-take-api.double-take-api.workers.dev`.

| Route | Auth | Returns |
|---|---|---|
| `GET /health` | none | `{ ok, storage }` |
| `GET /feed?name=demo` | `Authorization: Bearer <DEMO_PASSCODE>` | feed JSON with signed, absolute media URLs |
| `GET/HEAD /m/media/<clip>/v<n>/<file>?exp&sig` | signature | media bytes, with `Range` → `206` |

Each clip has `720.mp4`, `poster.jpg`, a 12-second silent `tile.mp4` (long side 480) for the
web landing's gallery, and its `tells.<hash>.json` files. The feed signs every one of them.

Signed URLs expire at the end of the next UTC day, so a URL stays identical all day
(the player cache keeps hitting) and works for 24–48 h. Only `media/` keys are servable;
`archive/` is never uploaded and `feeds/` is only reachable through `/feed`.

## Storage: no payment method needed

Media ships with the Worker as **static assets** (`STORAGE=assets`, the default). The account
stays on the Workers Free plan with no card on file: asset requests are free, and going over
100k requests/day returns errors, never charges. Limits: 20,000 files, 25 MiB per file.

Assets ignore `Range` and report no size, so `scripts/stage.ts` writes `build/asset-manifest.json`
(size, type, content hash per file) and the Worker cuts byte ranges itself (`src/storage.ts`).

To move to R2 later (needs R2 enabled, which needs a card): create the bucket, set
`STORAGE` to `"r2"` and uncomment `r2_buckets` in `wrangler.jsonc`, `npm run types`,
`npm run publish:remote`, `npm run deploy`. Nothing else changes.

## Local

```bash
python3 -I scripts/harvest/build_media.py scripts/harvest/spot_test.jsonl --out build   # from repo root
cd worker
npm install
printf 'DEMO_PASSCODE=%s\nSIGNING_KEY=%s\n' "$(openssl rand -hex 8)" "$(openssl rand -hex 32)" > .dev.vars
npm run dev               # stages build/ and serves http://localhost:8787 (add -- --ip 0.0.0.0 for a phone on Wi-Fi)
npm test                  # unit tests
npm run test:e2e          # end-to-end against the running Worker
```

## Cloud

```bash
npm run deploy                         # stages build/ and uploads Worker + changed assets
npx wrangler secret bulk .prod.vars    # first time only; .prod.vars is git-ignored
BASE_URL=https://double-take-api.double-take-api.workers.dev \
DEMO_PASSCODE=$(grep DEMO_PASSCODE .prod.vars | cut -d= -f2) npm run test:e2e
npx wrangler tail                      # live request log
```

New clips: rerun `build_media.py`, then `npm run deploy`. Media paths are versioned (`v1/`),
so a re-encode goes to `v2/` and nothing a client cached is ever overwritten.
