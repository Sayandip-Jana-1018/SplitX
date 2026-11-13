/**
 * The frame every screen sits in: the fonts, the person's look, the ledger, one clock for the
 * glass, the liquid behind everything, a stack of screens with clear backgrounds so the liquid
 * shows, and the toasts above them.
 */
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LedgerProvider } from '~/data/LedgerProvider';
import { GlassProvider, TouchRipples } from '~/glass/GlassProvider';
import { LiquidWall } from '~/glass/LiquidWall';
import { ThemeProvider, useLook } from '~/theme/ThemeProvider';
import { FONT_FILES } from '~/theme/type';
import { ToastProvider } from '~/ui/Toast';

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
                    <LedgerProvider>
                        <Frame />
                    </LedgerProvider>
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
            <TouchRipples style={{ flex: 1, backgroundColor: tokens.bg }}>
                <LiquidWall />
                <ToastProvider>
                    <NavigationTheme value={navigationTheme}>
                        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
                            <Stack.Screen name="index" />
                            <Stack.Screen name="onboarding" />
                            <Stack.Screen name="sign-in" />
                            <Stack.Screen name="(tabs)" />
                            <Stack.Screen name="group/[id]" />
                            <Stack.Screen name="chat/[id]" />
                            <Stack.Screen name="expense/[id]" />
                            <Stack.Screen name="journey" />
                            <Stack.Screen name="insights" />
                            <Stack.Screen name="profile" />
                            <Stack.Screen name="appearance" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                            <Stack.Screen name="add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                            <Stack.Screen name="pay" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                        </Stack>
                    </NavigationTheme>
                </ToastProvider>
                <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
            </TouchRipples>
        </GlassProvider>
    );
}
