// In a browser, Skia runs as WebAssembly (public/canvaskit.wasm, copied by `npm install`), and
// it has to be loaded before any screen draws. The web build exists for quick looks during design.
// The router is required, not imported: a dynamic import would split it into a chunk of its own.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above: it must not be split off
    require('expo-router/entry');
});
