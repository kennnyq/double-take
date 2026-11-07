# Double Take

A short-video feed app built with Expo (React Native) for iOS and iPadOS, with web through Expo.

## Run on your iPhone or iPad

1. Install **Expo Go** from the App Store.
2. Make sure the phone and this Mac are on the same Wi-Fi network.
3. Start the dev server:

   ```sh
   npm install
   npx expo start
   ```

4. Scan the QR code with the iPhone Camera app.

Edits hot-reload on the device.

```sh
npm test            # unit tests (node --test)
npm run typecheck
npm run lint
```

## Layout

| Path | What it is |
| --- | --- |
| `src/app/` | Expo Router routes: `_layout.tsx` (status bar, orientation) and `index.tsx` (tab shell) |
| `src/ui/` | Pill tab bar and placeholder tabs |

iPhone is locked to portrait. iPad rotates freely.
