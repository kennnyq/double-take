# Accounts and social features

## How they behave

- **Signed out, guests, members.** Signed out, you can watch everything and see public counts. Any write (like, double-tap, save, repost, follow, send, comment, comment like, create) opens a sheet: sign in, create an account, or **Continue as guest**. The action then runs by itself.
- **Guests** (no Supabase session; `src/auth/guest.ts`) can do everything members can, kept on this device only: the same reducer and actions, with the state stored as the same key rows a member loads from Supabase (`src/social/localRows.ts`) and rebuilt against the live feed. The choice is remembered across reloads; the profile shows "Guest" with "Sign in to save across devices". Signing out of an account forgets the choice, back to the sheet. Turning a guest into an account isn't built yet: it would replay the stored rows as writes for the new account after sign-up (`planWrite` already maps them), then clear them.
- **Sign-in:** a username and password, with Sign in and Create account modes in one sheet (a sheet on phones, a dialog on desktop; also the You tab / rail "Log in" for guests). The username is your `@handle`. No email is asked for or sent. Sign out from the profile menu or the rail.
- **Store:** one reducer (`src/social/`) holds liked, saved, reposted, sent, followed authors and your comments. Members see changes at once; each write is saved to Supabase in the background (latest state wins per item) and rolled back with a toast if it fails. On sign-in your lists load and profile tiles are rebuilt from the live feed.
- **Keys:** clips are keyed by the Worker's clip id (`sourceId`). Placeholder clips have no stable id, so actions on them stay on the device.
- **Visibility:** likes, reposts, follows and comments are public (counts come from `clip_stats`); saves, sends and comment likes are private. Row level security enforces it (`supabase/migrations/`).
- **Local mode:** without `EXPO_PUBLIC_SUPABASE_*` in `.env.local` the app works as before: in memory, nothing gated.
- **Actions and toasts:** every action has haptics and a toast (Saved · View, Reposted · Undo, Sent, …).
- **Comments:** stand-in comments and replies are generated per clip, alongside members' real comments.
- **Share:** Send to with friend search, repost, copy link, system share and download.
- **Profile:** tapping a tile jumps back to that clip in the feed.

## Setup

- **How usernames work:** Supabase Auth needs an email per user, so `alice` signs up as `alice@users.double-take.invalid`. The `.invalid` domain is reserved (RFC 2606) and never delivered, and the user never sees it. "Confirm email" is off, so sign-up signs you in at once. The database trigger makes the handle exactly the username and refuses any other kind of sign-up except dev test accounts (`supabase/migrations/20261108020000_usernames.sql`).
- **Supabase project:** email provider on (it carries the password sign-in), confirm email off, anonymous sign-ins off. Passwords need 8+ characters with letters and numbers; changing one needs the current password. Apply new migrations from `supabase/migrations/` (Supabase CLI `supabase db push`, or the Management API).
- **Profile notes** (the bubble over the avatar) stay on the device for everyone for now, one per signed-in account plus one for guests (`src/profile/note.ts`). The database has a `profiles.note` column (migration `20261108120000_profile_note.sql`) that isn't used yet.
- **Cloud settings** (`app_config`, read by anyone, edited only in the Supabase table editor): `useCloudConfig(key, fallback, accept)` in `src/config/cloud.ts` reads them once per run (3 s timeout, fallback until then). `tells_pipeline` (a JSON string such as `"main"` or `"claude"`) is the default for Dev settings → Model; a viewer's own pick there still wins, and unknown names show main.
- **Prepared demo checks** (`demo_checks` + the public `demo-media` bucket): `lookupDemoCheck({ sha256?, url? })` in `src/demo/lookup.ts` returns the stored result and a public media URL, or null (2.5 s timeout, never throws). Load a bundle with `node scripts/demo/import-demo-checks.ts <dir> [--dry-run]` (format in `scripts/demo/bundle.ts`); it reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `scripts/demo/.env.local`, else `worker/.dev.vars`.
- **App env** (`.env.local`, public by design): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and for dev builds `EXPO_PUBLIC_DEV_AUTH_URL` (web keeps its port and swaps in the page's host).
- **Worker dev env** (`worker/.dev.vars`, never in production): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DEV_AUTH=1`.
- **Test accounts:** `npm run dev:auth` (add `-- --port <n>` for another port) serves the Worker's `/dev/*` routes. Dev builds then sign in as `alice`, `bob`, `carol` or a fresh throwaway in one tap (from the sign-in sheet or the wrench → Accounts tab). They have no passwords, so none sit in the repo for accounts that live in the shared project: the route mints a one-time token with the secret key instead. The tab also wipes a test account's data and simulates token expiry. Without `DEV_AUTH` (as in production) every `/dev/*` path is a 404.
- **Free plan:** the project pauses after 7 days without activity; the app then falls back to stand-in counts. Unpause from the dashboard, or move to Pro when there are real users.

## Security notes

- Sign-in errors are the same for a wrong password and an unknown username. Create account says when a username is taken, which can't be avoided: handles are public anyway.
- Sign-in and sign-up are rate limited per IP by Supabase Auth.
- Leaked-password checks (HaveIBeenPwned) need the Pro plan; turn them on when moving to Pro.
- Add a captcha (Turnstile) on sign-up and sign-in before launch.

## Later

- **Password reset:** with no real email there's nothing to send a reset link to. Let members add an optional recovery email (needs a custom SMTP sender such as Resend, since the built-in one only reaches the project's team), then offer "Forgot password".
- **Sign in with Apple** (`expo-apple-authentication` + `signInWithIdToken`; needs a dev build in production), then **Google** (OAuth with redirect URLs). Both need the sign-up rule in the migration relaxed.
