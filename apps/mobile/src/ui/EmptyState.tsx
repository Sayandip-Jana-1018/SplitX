/**
 * What a screen says when there's nothing to show yet, and what to do about it. Its emoji floats
 * gently in a circle of glass (still in Calm).
 */
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Text } from './Text';

export function EmptyState({ emoji, title, hint, action }: { emoji: string; title: string; hint: string; action?: ReactNode }) {
    const { tokens, calm } = useLook();
    const lift = useSharedValue(0);
    useEffect(() => {
        if (calm) {
            cancelAnimation(lift);
            lift.set(0);
            return;
        }
        lift.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
        return () => cancelAnimation(lift);
    }, [calm, lift]);
    const float = useAnimatedStyle(() => ({ transform: [{ translateY: -5 * lift.value }, { rotate: `${(lift.value - 0.5) * 6}deg` }] }));

    return (
        <GlassSurface style={{ paddingVertical: 26, paddingHorizontal: 20, gap: 10, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: tokens.chip, borderWidth: 1, borderColor: tokens.border, alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                <Animated.View style={float}>
                    <Text style={{ fontSize: 34, lineHeight: 42 }}>{emoji}</Text>
                </Animated.View>
            </View>
            <Text variant="heading">{title}</Text>
            <Text variant="caption" tone="secondary" style={{ maxWidth: 280 }}>
                {hint}
            </Text>
            {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
        </GlassSurface>
    );
}
