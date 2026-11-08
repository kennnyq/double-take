This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## UI motion

Kenny's rule: **"Avoid discrete motion and animation except for navigation."**

- Every UI state change moves continuously: interpolated, spring or eased, and interruptible (a new target retargets from where the motion is, it never restarts or snaps). Fade, scale or morph things in and out instead of mounting or unmounting them abruptly.
- Only navigation (tab or route changes) may cut.
- Exception: decorative text effects Kenny has explicitly signed off on may be discrete. So far there is one: the landing hero's "twice" glitch emphasis (`.lt-em-glitch`, `steps(1)` bursts in `src/landing/landing.css`).
- Video position: never jump straight to a timestamp. Fast-forward or rewind to it with a quick, visible, eased scrub (see `src/feed/scrub.ts`). The one allowed jump is the double take's slow-mo loop restart, which its progress line shows.
- Prefer `react-native-reanimated` (UI-thread springs and timings) for new motion; on desktop web, CSS transitions are fine.
- Keep motion cheap (it has to hold 60 fps on an iPhone in Expo Go): animate only `transform`, `opacity`, colors and `borderRadius` (Reanimated's no-layout fast path), never `width`/`height`/`left`/`top` per frame. No live blur (`BlurView`, `backdrop-filter`) over playing video by default, no rounded `overflow: hidden` around video while it animates, and no partial `opacity` on a view with children that stays that way (iOS composites it offscreen every frame). On web, give an animated view its own layer (`src/feed/layer.ts`).
