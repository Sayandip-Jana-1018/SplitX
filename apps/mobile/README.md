# SplitIT for Android and iPhone

The phone app: the website's Liquid Glass, drawn on the phone's GPU with Skia. The plan and its
phases are in [docs/mobile/ROADMAP.md](../../docs/mobile/ROADMAP.md).

## Run it

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
