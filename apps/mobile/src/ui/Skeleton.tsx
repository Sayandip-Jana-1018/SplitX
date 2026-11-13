/** A soft placeholder that breathes while something loads; still in calm motion. */
import { useEffect } from 'react';
import { type DimensionValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useLook } from '~/theme/ThemeProvider';

export function Skeleton({ width = '100%', height, radius = 14 }: { width?: DimensionValue; height: number; radius?: number }) {
    const { tokens, calm } = useLook();
    const glow = useSharedValue(0.55);
    useEffect(() => {
        glow.set(calm ? 0.7 : withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    }, [calm, glow]);
    const breathe = useAnimatedStyle(() => ({ opacity: glow.value }));
    return <Animated.View accessibilityLabel="Loading" style={[{ width, height, borderRadius: radius, backgroundColor: tokens.chip }, breathe]} />;
}
