// Skia's web loader ships without types at this path.
declare module '@shopify/react-native-skia/lib/module/web' {
    export function LoadSkiaWeb(options?: { locateFile?: (file: string) => string }): Promise<void>;
}

// Expo Router's entry registers the app and exports nothing.
declare module 'expo-router/entry';
