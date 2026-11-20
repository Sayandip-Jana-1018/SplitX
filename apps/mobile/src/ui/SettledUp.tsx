/**
 * All settled up, celebrated: the coin turns above a small burst of coins that flies out once, in
 * your colour, and fades. Calm keeps the coin still and leaves the burst out.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { Coin } from '~/glass/Coin';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Text } from './Text';

const COINS = 14;
const SIZE = 112;

function Spark({ index, progress, colour }: { index: number; progress: SharedValue<number>; colour: string }) {
    // Evenly round the coin, each a little further or nearer, a little bigger or smaller.
    const angle = (index / COINS) * Math.PI * 2 + (index % 2 ? 0.18 : -0.12);
    const reach = 74 + (index % 3) * 16;
    const size = 6 + (index % 4) * 2;
    const style = useAnimatedStyle(() => ({
        opacity: progress.value <= 0 ? 0 : 1 - progress.value,
        transform: [{ translateX: Math.cos(angle) * reach * progress.value }, { translateY: Math.sin(angle) * reach * progress.value - 8 * progress.value }, { scale: 1 - 0.4 * progress.value }],
    }));
    return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: colour }, style]} />;
}

export function SettledUp({ hint }: { hint: string }) {
    const { tokens, calm } = useLook();
    const progress = useSharedValue(0);
    useEffect(() => {
        if (calm) return;
        progress.set(withDelay(250, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) })));
    }, [calm, progress]);

    return (
        <GlassSurface style={{ paddingTop: 22, paddingBottom: 24, paddingHorizontal: 20, gap: 8, alignItems: 'center' }}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
                {calm
                    ? null
                    : Array.from({ length: COINS }, (_, index) => <Spark key={index} index={index} progress={progress} colour={index % 3 === 0 ? tokens.accentText : tokens.accent} />)}
                <Coin kind="rim" size={SIZE} />
            </View>
            <Text variant="title">All settled up</Text>
            <Text variant="caption" tone="secondary" style={{ maxWidth: 280 }}>
                {hint}
            </Text>
        </GlassSurface>
    );
}
