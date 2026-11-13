/**
 * Welcome: the coin that splits into shares and comes back whole, which is the app in one picture,
 * with the promise on it. Get started shows what the app does; sign-in arrives in Phase 3, and for now its screen opens the app.
 */
import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Coin } from '~/glass/Coin';
import { GlassLayer } from '~/glass/layer';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton } from '~/ui/GlassButton';
import { Text } from '~/ui/Text';
import { Wordmark } from '~/ui/TopBar';

export default function Welcome() {
    const { tokens, calm } = useLook();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const coin = Math.min(width * 1.08, height * 0.56, 520);
    const enter = (delay: number) => (calm ? undefined : FadeIn.delay(delay).duration(420));

    return (
        <GlassLayer style={{ flex: 1, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, alignItems: 'center' }}>
            <Animated.View entering={calm ? undefined : FadeIn.duration(500)}>
                <GlassSurface kind="thin" radius={999} style={{ paddingVertical: 8, paddingHorizontal: 16 }}>
                    <Wordmark />
                </GlassSurface>
            </Animated.View>

            <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View entering={calm ? undefined : FadeIn.duration(1200)} style={{ position: 'absolute' }}>
                    <Coin kind="split" size={coin} />
                </Animated.View>
                <Animated.View entering={enter(150)} style={{ alignItems: 'center', gap: 6, paddingHorizontal: 12 }}>
                    <Text variant="hero" onLiquid>
                        Split expenses
                    </Text>
                    <Text variant="hero" tone="accent" onLiquid>
                        Keep the Vibe.
                    </Text>
                    <Text variant="body" tone="secondary" onLiquid style={{ marginTop: 10, maxWidth: 300 }}>
                        One shared memory deserves one calm money story.
                    </Text>
                </Animated.View>
            </View>

            <Animated.View entering={enter(320)} style={{ width: '100%', maxWidth: 420, gap: 12 }}>
                <GlassButton kind="accent" radius={999} contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} onPress={() => router.push('/onboarding')}>
                    <Text variant="heading" tone="onAccent">
                        Get started
                    </Text>
                    <ArrowRight size={20} color={tokens.onAccent} strokeWidth={2.4} />
                </GlassButton>
                <GlassButton kind="thin" radius={999} contentStyle={{ height: 54 }} onPress={() => router.push('/sign-in')}>
                    <Text variant="label">I already have an account</Text>
                </GlassButton>
                <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                    Preview build · the people and money in it are made up
                </Text>
            </Animated.View>
        </GlassLayer>
    );
}
