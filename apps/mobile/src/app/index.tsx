/**
 * Welcome: the coin that splits into shares and comes back whole, which is the app in one picture,
 * with the promise on it. Get started shows what the app does; sign-in arrives in Phase 3, and for now its screen opens the app.
 */
import { Redirect, router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '~/auth/AuthProvider';
import { enterApp } from '~/auth/flow';
import { Coin } from '~/glass/Coin';
import { GlassLayer } from '~/glass/layer';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Appear } from '~/ui/Appear';
import { GlassButton } from '~/ui/GlassButton';
import { Text } from '~/ui/Text';
import { ThemeButton, Wordmark } from '~/ui/TopBar';

export default function Welcome() {
    const { tokens } = useLook();
    const auth = useAuth();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const coin = Math.min(width * 1.08, height * 0.56, 520);

    // Signed in, or trying the demo: the app opens where it belongs. Still reading storage: nothing yet.
    if (auth.status === 'signed_in' || auth.status === 'demo') return <Redirect href="/home" />;
    if (auth.status === 'loading') return null;

    return (
        <GlassLayer style={{ flex: 1, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, alignItems: 'center' }}>
            <Appear duration={500} style={{ width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <GlassSurface kind="thin" radius={999} style={{ paddingVertical: 8, paddingHorizontal: 16 }}>
                    <Wordmark />
                </GlassSurface>
                <View style={{ position: 'absolute', right: 0 }}>
                    <ThemeButton size={42} />
                </View>
            </Appear>

            <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <Appear duration={1200} style={{ position: 'absolute' }}>
                    <Coin kind="split" size={coin} />
                </Appear>
                <Appear delay={150} duration={420} style={{ alignItems: 'center', gap: 6, paddingHorizontal: 12 }}>
                    <Text variant="hero" onLiquid>
                        Split expenses
                    </Text>
                    <Text variant="hero" tone="accent" onLiquid>
                        Keep the Vibe.
                    </Text>
                    <Text variant="body" tone="secondary" onLiquid style={{ marginTop: 10, maxWidth: 300 }}>
                        One shared memory deserves one calm money story.
                    </Text>
                </Appear>
            </View>

            <Appear delay={320} duration={420} style={{ width: '100%', maxWidth: 420, gap: 12 }}>
                <GlassButton kind="accent" radius={999} contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} onPress={() => router.push('/onboarding')}>
                    <Text variant="heading" tone="onAccent">
                        Get started
                    </Text>
                    <ArrowRight size={20} color={tokens.onAccent} strokeWidth={2.4} />
                </GlassButton>
                <GlassButton kind="thin" radius={999} contentStyle={{ height: 54 }} onPress={() => router.push('/sign-in')}>
                    <Text variant="label">I already have an account</Text>
                </GlassButton>
                <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    style={{ alignSelf: 'center', marginTop: 4 }}
                    onPress={async () => {
                        await auth.startDemo();
                        enterApp();
                    }}
                >
                    <Text variant="label" tone="accent" onLiquid>
                        Just looking? Try the demo
                    </Text>
                </Pressable>
            </Appear>
        </GlassLayer>
    );
}
