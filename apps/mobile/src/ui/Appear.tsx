/**
 * Content that fades in once, a moment after it first shows: Home's sections one after another,
 * the rows of Groups, the welcome. Calm shows it at once.
 *
 * Only its opacity moves, as an ordinary animated style. Reanimated's entering animations
 * (FadeIn on an Animated.View) did this before, through its layout animations, which on the new
 * architecture stand between React's layout and the native views. A section with one stopped
 * following the layout: when the notifications card on Home went away, the coin, the totals and
 * the four buttons stayed where they had been, 236 points low, under glass drawn where they belong.
 * Nothing here touches layout, so the views always sit where React puts them.
 *
 * Toasts and the onboarding pages keep Reanimated's animations: they need exit animations, and
 * nothing above them moves.
 */
import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useLook } from '~/theme/ThemeProvider';

interface Props extends ViewProps {
    /** Milliseconds before it starts. */
    delay?: number;
    duration?: number;
}

export function Appear({ delay = 0, duration = 380, style, ...rest }: Props) {
    const { calm } = useLook();
    const opacity = useSharedValue(calm ? 1 : 0);

    useEffect(() => {
        opacity.set(calm ? 1 : withDelay(delay, withTiming(1, { duration })));
        // Once, as it first shows: a later render never fades it again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Turning calm on mid-fade shows it at once.
    useEffect(() => {
        if (calm) opacity.set(1);
    }, [calm, opacity]);

    const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return <Animated.View style={[style, fade]} {...rest} />;
}
