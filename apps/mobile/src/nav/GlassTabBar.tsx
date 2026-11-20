/**
 * The floating tab bar: one pill of glass, four places, and adding an expense in its centre,
 * where the thumb rests.
 *
 * The place you're on sits in a lens of brighter glass that glides to the next one you tap,
 * stretching a little on the way like a drop of liquid, and the icon you chose springs. Calm moves
 * the lens at once.
 */
import { router } from 'expo-router';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import { Plus, type LucideIcon } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '~/glass/GlassSurface';
import { GlassLayer } from '~/glass/layer';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Text } from '~/ui/Text';

/** Where the lens should sit: the focused tab tells the bar its place. */
const LensContext = createContext<((x: number, width: number) => void) | null>(null);

const GLIDE = { damping: 17, stiffness: 190, mass: 0.9 };

export function GlassTabBar({ children }: ViewProps & { children?: ReactNode }) {
    const insets = useSafeAreaInsets();
    const { tokens, calm } = useLook();
    const x = useSharedValue(0);
    const width = useSharedValue(0);
    const stretch = useSharedValue(1);
    const placed = useRef(false);

    const moveTo = useCallback(
        (nextX: number, nextWidth: number) => {
            // The first place, and every place in Calm, is taken at once.
            if (!placed.current || calm) {
                placed.current = true;
                x.set(nextX);
                width.set(nextWidth);
                return;
            }
            const distance = Math.abs(nextX - x.value);
            stretch.set(withSequence(withTiming(1 + Math.min(distance / 360, 0.38), { duration: 130 }), withSpring(1, { damping: 11, stiffness: 170 })));
            x.set(withSpring(nextX, GLIDE));
            width.set(withSpring(nextWidth, GLIDE));
        },
        [calm, x, width, stretch],
    );

    const lens = useAnimatedStyle(() => ({ width: width.value, opacity: width.value > 0 ? 1 : 0, transform: [{ translateX: x.value }, { scaleX: stretch.value }, { scaleY: 2 - stretch.value }] }));

    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 12) + 4, alignItems: 'center' }}>
            <GlassLayer style={{ width: '92%', maxWidth: 440 }}>
                <GlassSurface kind="thick" radius={999} style={{ flexDirection: 'row', alignItems: 'center', padding: 6 }}>
                    <Animated.View
                        pointerEvents="none"
                        style={[{ position: 'absolute', left: 0, top: 6, bottom: 6, borderRadius: 999, backgroundColor: tokens.chip, borderWidth: 1, borderColor: tokens.border }, lens]}
                    />
                    <LensContext.Provider value={moveTo}>{children}</LensContext.Provider>
                </GlassSurface>
            </GlassLayer>
        </View>
    );
}

interface TabButtonProps extends TabTriggerSlotProps {
    icon: LucideIcon;
    label: string;
}

// The trigger's ref is for its own default button; this one doesn't need it.
export function TabButton({ icon: Icon, label, isFocused, onPress, ref: _ref, ...rest }: TabButtonProps) {
    const { tokens, calm } = useLook();
    const moveLens = useContext(LensContext);
    const spot = useRef<{ x: number; width: number } | null>(null);
    const pop = useSharedValue(1);
    const color = isFocused ? tokens.fg : tokens.muted;

    // Focused: the lens comes here, and the icon springs.
    useEffect(() => {
        if (!isFocused) return;
        if (spot.current) moveLens?.(spot.current.x, spot.current.width);
        if (!calm) pop.set(withSequence(withTiming(1.16, { duration: 120 }), withSpring(1, { damping: 9, stiffness: 220 })));
    }, [isFocused, calm, moveLens, pop]);

    const laidOut = (event: LayoutChangeEvent) => {
        const { x, width } = event.nativeEvent.layout;
        spot.current = { x, width };
        if (isFocused) moveLens?.(x, width);
    };
    const icon = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
    const labelStyle = useMemo(() => ({ color, fontSize: 11 }), [color]);

    return (
        <Pressable
            {...rest}
            onLayout={laidOut}
            onPress={(event) => {
                tap();
                onPress?.(event);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            style={{ flex: 1, minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2 }}
        >
            <Animated.View style={icon}>
                <Icon size={21} color={color} strokeWidth={isFocused ? 2.4 : 2} />
            </Animated.View>
            <Text variant="caption" weight={isFocused ? 'bold' : 'semibold'} style={labelStyle}>
                {label}
            </Text>
        </Pressable>
    );
}

export function AddButton() {
    const { tokens } = useLook();
    return (
        <View style={{ flex: 1, alignItems: 'center' }}>
            <GlassButton kind="accent" contentStyle={{ width: 56, height: 56 }} accessibilityLabel="Add an expense" onPress={() => router.push('/add')}>
                <Plus size={26} color={tokens.onAccent} strokeWidth={2.4} />
            </GlassButton>
        </View>
    );
}
