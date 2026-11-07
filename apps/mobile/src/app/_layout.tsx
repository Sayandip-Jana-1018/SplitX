/**
 * The frame every screen sits in: the fonts, the person's look, one clock for the glass, the
 * liquid behind everything, and a stack of screens with clear backgrounds so the liquid shows.
 */
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GlassProvider } from '~/glass/GlassProvider';
import { LiquidWall } from '~/glass/LiquidWall';
import { ThemeProvider, useLook } from '~/theme/ThemeProvider';
import { FONT_FILES } from '~/theme/type';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
    const [fontsLoaded, fontError] = useFonts(FONT_FILES);
    const ready = fontsLoaded || Boolean(fontError);

    useEffect(() => {
        if (ready) SplashScreen.hideAsync().catch(() => undefined);
    }, [ready]);

    if (!ready) return null;
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <ThemeProvider>
                    <Frame />
                </ThemeProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function Frame() {
    const { mode, tokens } = useLook();
    const navigationTheme = useMemo(() => {
        const base = mode === 'dark' ? DarkTheme : DefaultTheme;
        return { ...base, colors: { ...base.colors, background: 'transparent', card: 'transparent', primary: tokens.accentText, text: tokens.fg } };
    }, [mode, tokens]);

    return (
        <GlassProvider>
            <View style={{ flex: 1, backgroundColor: tokens.bg }}>
                <LiquidWall />
                <NavigationTheme value={navigationTheme}>
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="appearance" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                        <Stack.Screen name="add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                    </Stack>
                </NavigationTheme>
                <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
            </View>
        </GlassProvider>
    );
}
