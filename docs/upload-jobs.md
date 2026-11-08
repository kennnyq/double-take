# Portable upload jobs runner

The runner stores uploads, prepares playable media, and runs an optional operator-supplied analyzer. It has no application, research, model-service, or dataset imports. An unconfigured or disabled analyzer leaves the original upload available in a recoverable error state. No analyzer, hosted call, credential lookup, or prepared collection is built in.

## Copy boundary

Copy exactly these files, preserving their relative paths:

```text
scripts/jobs/analyzer.ts
scripts/jobs/links.ts
scripts/jobs/media.ts
scripts/jobs/server.ts
scripts/jobs/types.ts
scripts/jobs/upload-log.ts
scripts/jobs/worker.ts
scripts/jobs/preview.ts
scripts/jobs/links.test.ts
scripts/jobs/media.test.ts
scripts/jobs/portable.test.ts
scripts/jobs/server.test.ts
docs/upload-jobs.md
```

The first seven are the runtime. `preview.ts` is an explicit instructional fixture backend, optional and never selected by the normal runner. The four test files use generated media and temporary directories. If replacing an older jobs directory, remove its `allowance.test.ts` and `start-app.sh`; neither belongs to this portable package. Do not copy data directories or unrelated source/history.

## Requirements and start

Use Node.js24 or newer (native TypeScript stripping), `ffmpeg`, and `ffprobe` on PATH. No npm package is required by the runner itself. Give one runner exclusive use of a persistent, private data directory outside any public/static document root. Run it behind your application's authenticated reverse proxy; CORS is an origin allowlist, not authentication. Job URLs identify private uploads and should not be shared publicly.

Set these operator values explicitly:

```sh
export JOBS_DIR=/absolute/private/upload-data
export JOBS_ORIGIN=https://your-app.example
export PORT=8790
# Optional; leave unset to retain uploads without running analysis.
export JOBS_ANALYZER_MODULE=/absolute/operator/analyzer.mjs
export JOBS_ANALYZER_TIMEOUT_MS=45000
node scripts/jobs/server.ts
```

`JOBS_DIR` has no default. `JOBS_ORIGIN` accepts comma-separated exact origins; by default no cross-origin access is allowed. The listener binds `0.0.0.0`. `JOBS_ANALYZER_DISABLED=1` disables analysis even when a module is configured. Modules must have an absolute path and export `analyze`. Timeout accepts100–300000ms and defaults to45000ms. This bounds analysis, not upload/decode/transcode time.

The worker inherits the operator environment. Treat the module as trusted executable server code: the subprocess is a timeout/isolation boundary, **not a security sandbox**. Analyzer-specific credentials, budgets, networking, and dependency installation belong to that module/operator. The runner never interprets or resets a provider's quota. POSIX timeouts kill the worker process group including descendants; on Windows the worker itself is terminated.

## Analyzer interface

See `types.ts` for the standalone wire types. A module exports:

```js
export async function analyze(input, context) {
  // input: clipId, mediaSha256, mediaPath, duration, width, height, hasAudio.
  // mediaPath always names ORIGINAL bytes, never the playback proxy.
  // context: outputDir, deadline (epoch milliseconds), signal (AbortSignal).
  return {
    version: 1,
    clipId: input.clipId,
    mediaSha256: input.mediaSha256,
    mode: 'fresh',
    components: [],
    evidence: [],
    limitations: ['Example only; no analysis was performed.'],
    elapsedMs: 0,
    trace: [],
  };
}
```

Return the application's component/evidence schema and optional `inspection` coverage when available. The runner does not invent inspection, explanations, findings, or a verdict. The analyzer owns semantic validation and public prose. Results must match both job/clip ID and the original upload SHA256, use version1, and contain valid envelope arrays and finite elapsed time. Both worker and server verify that envelope; mismatches fail closed without exposing results. Serialized output is capped at2MiB. Arbitrary worker exceptions/stdout/stderr do not reach HTTP responses. Public responses allowlist result fields and remove `trace` recursively, including inspection/evidence nesting. Saved results remain private on disk.

## HTTP and recovery

- `GET /health`: readiness of the HTTP runner, not analyzer availability.
- `GET /prepared`: `[]`. Prepared items are not bundled; item routes return404.
- `PUT /jobs/<64 lowercase hex>`: original file bytes, at most100MiB.
- `POST /jobs/<id>`: JSON `{ "url": "https://public.example/video.mp4" }` for a direct public MP4/MOV. No social-page extraction or segment parameters.
- `GET /jobs/<id>`: queued/running/complete/error state, bound result only when complete. Error codes are stable; unavailable analysis has `retryable: true` and keeps media.
- `GET /jobs/<id>/media`: original compatible video or playback proxy, with byte-range responses.
- `POST /jobs/<id>/retry`: explicitly requeue an error after fixing/configuring the analyzer. Concurrent retry requests coalesce; queued/running/complete jobs are returned without another analysis. This is the only analysis retry operation.
- `DELETE /jobs/<id>`: delete saved job/media; active analysis or upload returns409.

A duplicate PUT reads and hashes the retry body: matching bytes return the existing job, different bytes return409. A duplicate link POST checks the stored link digest and never redownloads the URL. Neither operation reruns analysis. Restart retains completed bound results, removes rejected results, and marks interrupted running work as a recoverable error instead of repeating it automatically. Previously queued work drains serially. Rejected uploads have durable structured diagnostics independent of payload cleanup, so GET can explain a rejection after restart and the same ID may accept a corrected upload.

The limits are two receiving uploads, eight queued/reserved uploads, forty retained jobs, and one analyzer at a time. Job retention is24 hours. Private upload/rejection event logs are retained separately; operators must manage log retention and disk quotas. Original uploaded bytes and their hash remain unchanged when playback is normalized. The video stream duration—not padded audio/container duration—governs the60-second limit. Decode checks, rotation, HEVC/ProRes/VFR playback conversion, audio-tail trimming and AAC-LC compatibility remain supported.

Link retrieval requires HTTPS, no credentials or IP literals, validated public IPv4 DNS results, pinned connections/TLS hostname checking, fresh validation on every redirect, at most three redirects, video content type, identity encoding, and upload-size limits. IPv6 and social-page resolvers are intentionally unsupported. Local media probes/decoders allow only file/pipe protocols.

## Checks

The portable test copies only the seven runtime files into a temporary directory and tests disabled recovery, a custom analyzer subprocess, binding failures, timeout, private traces, CORS, and restart. Other tests exercise retry identity, durable rejection, media/proxy compatibility, range serving, limits, and SSRF policy with generated fixtures. No network analyzer or dataset is used.

Choose a free test port before running; tests default to8799. Serialize test files and do not share the data directory with another runner:

```sh
JOBS_TEST_PORT=8799 node --test --test-concurrency=1 scripts/jobs/*.test.ts
npm run lint
npm run typecheck
```

In a fresh Expo checkout lacking generated `expo-env.d.ts`, `npm run typecheck -- --types node,expo/types` supplies the same Expo ambient types without starting a dev server. The portable runtime itself does not use Expo or React Native APIs.

## App configuration

The Expo app requires an explicit `EXPO_PUBLIC_JOBS_URL`. For development use the runner's reachable HTTP address; localhost on a phone means the phone itself. Production builds require an HTTPS address behind the authenticated reverse proxy described above. Expo embeds this public URL at build time: restart Metro after changing it, or rebuild the production bundle. Never put analyzer keys in any `EXPO_PUBLIC_` variable.

Create opens the same modal from the desktop rail, phone tab, and profile plus button. Video checking does not require an account; existing account restrictions on social actions remain. `/investigate` remains a direct route. A missing URL, unreachable runner, timeout, or invalid result produces a recoverable message; failed transport retains a retry handle instead of crashing or showing another upload's result. The current modal is the interim presentation until the separately reviewed design is approved.

To verify before merging, start Expo to generate typed routes, run `npm run check`, and exercise each Create entry point, a real picker upload through processing to result, result playback, and an unavailable runner. An analyzer is separately configured server-side; no model weights, datasets, private media, keys, or research scripts belong in the app branch.
