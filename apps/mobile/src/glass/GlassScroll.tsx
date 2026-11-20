/**
 * A scroll view that tells the glass inside it how far it has moved.
 *
 * Scrolling up and down, its glass is drawn in strips that scroll with the content (ScrollPanes,
 * layer.tsx), so a pane never trails behind its words. A sideways row (chips, Home's groups) is
 * drawn by the page around it, following the row's own scroll.
 */
import { useContext, useMemo, type ComponentRef, type ReactNode, type Ref } from 'react';
import type { ScrollView, ScrollViewProps } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { ScrollPanes } from './layer';
import { ScrollContext } from './origin';

interface Props extends Omit<ScrollViewProps, 'onScroll'> {
    children?: ReactNode;
    /** For scrolling it from code (scrollTo). */
    ref?: Ref<ComponentRef<typeof ScrollView>>;
}

export function GlassScrollView({ horizontal, children, ref, ...rest }: Props) {
    const parent = useContext(ScrollContext);
    const offset = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((event) => {
        offset.value = horizontal ? event.contentOffset.x : event.contentOffset.y;
    });
    const offsets = useMemo(() => (horizontal ? { ...parent, x: offset } : { ...parent, y: offset }), [parent, horizontal, offset]);
    return (
        <ScrollContext.Provider value={offsets}>
            <Animated.ScrollView ref={ref as never} horizontal={horizontal} onScroll={onScroll} scrollEventThrottle={16} {...rest}>
                {horizontal ? children : <ScrollPanes offset={offset}>{children}</ScrollPanes>}
            </Animated.ScrollView>
        </ScrollContext.Provider>
    );
}
