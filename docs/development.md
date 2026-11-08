# Development

## Run on an iPhone or iPad

1. Install **Expo Go** from the App Store.
2. Put the phone and the computer on the same Wi-Fi network.
3. Start the dev server and scan the QR code with the phone's Camera app:

   ```bash
   npm ci
   npx expo start
   ```

Edits hot-reload on the device.

### Over Tailscale

When the phone isn't on the same Wi-Fi, run `npm run start:tailnet` instead. It advertises
this machine's tailnet name (for example `http://<machine>.<tailnet>.ts.net:8081`) in the
QR code, so any device signed in to the same tailnet can load the app. Extra arguments go to
`expo start` (`npm run start:tailnet -- --port 8090`). Inside WSL with NAT networking, the
script also asks Windows' Tailscale to forward the port into WSL while Metro runs.

## Checks

```bash
npm run check        # typecheck, lint, app + pipeline tests, Worker tests (offline)
npm test             # unit tests (node --test)
npm run typecheck
npm run lint
npm run check:prod   # end-to-end tests against the deployed Worker (needs worker/.prod.vars; BASE_URL overrides the URL)
npm run media        # regenerate placeholder clips into assets/media (needs ffmpeg)
```

Browser checks (`scripts/e2e/`, headless Chromium through `playwright-core`) run against a
dev server: `BASE_URL=http://localhost:8081 npm run e2e:hint`, and likewise `e2e:space`,
`e2e:taps`, `e2e:flow`, `e2e:scrub`, `e2e:wheel`, `e2e:overlay`, `e2e:icons`, `e2e:game`
and `e2e:lab`. `node scripts/e2e/landing-features.ts` takes frame strips and frame timings of
the landing's features tour. Run them one at a time.

## Environment files

- `.env.local` (repo root, public by design): the app's `EXPO_PUBLIC_*` settings (see the
  README). In development Expo bundles every root file whose name starts with `.env` into
  the web app, so keep secrets out of the root.
- `scripts/annotate/.env.local`: the NVIDIA key for the tells pipeline
  ([tells-pipeline.md](tells-pipeline.md)).
- `worker/.dev.vars` and `worker/.prod.vars`: the Worker's secrets.
- `npm run worktree:env` copies all of these from the main checkout into a new git worktree.

## Testing the web app against a local Worker

In development Expo reads `.env.local` over shell variables, so to point the web app at
`npm --prefix worker run dev`, build it instead:

```bash
EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=http://localhost:8787 EXPO_PUBLIC_DEMO_PASSCODE=… npx expo export -p web
```

then serve `dist/`.

## Hosting the web app

`npm run deploy:web` (`scripts/deploy-web.sh`) builds the web app for production and deploys
`dist/` as the static Worker `double-take-app` (`web/wrangler.jsonc`, with a single-page
fallback), separate from the feed Worker.

- The build ignores `.env` files and gets its settings explicitly: the cloud feed API, and
  the demo passcode and Supabase keys read from `ENV_FILE` (by default the main checkout's
  `.env.local`). Values are never printed.
- The job runner is left unset: an HTTPS page can't call a plain-HTTP runner, so the Upload
  card shows itself as unavailable until the runner is behind HTTPS.
- Deploying needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for the account that
  hosts it. `npm run deploy:web -- --build` only builds.
