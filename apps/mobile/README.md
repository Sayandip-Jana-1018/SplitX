# SplitIT for Android and iPhone

The phone app: the website's Liquid Glass, drawn on the phone's GPU with Skia. The plan and its
phases are in [docs/mobile/ROADMAP.md](../../docs/mobile/ROADMAP.md).

## Install it on your phone

SplitIT installs as an ordinary Android app; it needs no laptop, server or Expo Go once
installed, and what you add is kept on the phone.

1. **Get the APK.** Every push to `feat/app` that changes the app builds one on GitHub's
   machines (the workflow `.github/workflows/app-apk.yml`). Open the repository's **Actions**
   tab, then **App APK**, then the newest green run, and download **splitit-apk** at the bottom
   (signed in to GitHub). It's a zip holding `app-release.apk`.
2. **Install it.**
   - **Over USB:** `adb install -r app-release.apk`.
   - **On the phone:** open the APK from Files. Android asks once to allow installs from that app.
3. **Update it** the same way: a newer build installs over the older one and keeps your data,
   because each build's number is higher and every build is signed with the same key.

The build is signed with React Native's standard debug key: fine for your own phone, not for a
store. Building on the laptop isn't used, because a native build holds the CPU at full load for
15-25 minutes and the laptop runs with one fan.

## Run it while building

The live preview, for seeing changes as they're made:

```bash
cd apps/mobile
npm install
npm start
```

- **On your phone:** install **Expo Go** from the Play Store, keep the phone on the same Wi-Fi as
  the laptop, and scan the QR code the terminal shows.
- **In a browser,** for a quick look while designing: `npm run web`. Skia runs there as WebAssembly,
  which `npm install` copies to `public/canvaskit.wasm`.

## Check it

```bash
npm run typecheck
npx expo export --platform android
```

The second one bundles the app for Android without a phone, which catches missing imports and
broken transforms.

## How it is laid out

| Folder | What it holds |
|---|---|
| `src/app` | The screens, one file per route (Expo Router). `(tabs)` is the four main places. |
| `src/glass` | The glass engine: the liquid wall, glass surfaces, coins, and the Skia shaders. |
| `src/theme` | Colours from the palettes, the person's look, fonts and the type scale. |
| `src/ui` | Text, buttons of glass, avatars, money formatting, the screen frame. |
| `src/nav` | The floating tab bar. |
| `src/data` | Made-up people and money for building screens. Phase 2 replaces it with the API. |

## Shared with the website

`@shared/*` points at the website's `src/lib`. Today the app reads `src/lib/glass`: the palettes,
the kinds of glass, the liquid's motion, and the coins and their shader. Those files import nothing,
and the functions the phone runs on its UI thread are marked `'worklet'`, which the website ignores.
Change them once and both apps follow. The coin shader is converted at start-up
(`src/glass/sksl.ts`), and it stops with a clear error if the website's shader changes shape.

The website's own checks (`npm test`, `npm run lint`, `npm run lint:unused` at the repository's root)
leave this folder alone; it has its own.
