/** A scroll view that tells the glass inside it how far it has moved. */
import { useContext, useMemo, type ReactNode } from 'react';
import type { ScrollViewProps } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { ScrollContext } from './origin';

interface Props extends Omit<ScrollViewProps, 'onScroll'> {
    children?: ReactNode;
}

export function GlassScrollView({ horizontal, children, ...rest }: Props) {
    const parent = useContext(ScrollContext);
    const offset = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((event) => {
        offset.value = horizontal ? event.contentOffset.x : event.contentOffset.y;
    });
    const offsets = useMemo(() => (horizontal ? { ...parent, x: offset } : { ...parent, y: offset }), [parent, horizontal, offset]);
    return (
        <ScrollContext.Provider value={offsets}>
            <Animated.ScrollView horizontal={horizontal} onScroll={onScroll} scrollEventThrottle={16} {...rest}>
                {children}
            </Animated.ScrollView>
        </ScrollContext.Provider>
    );
}
