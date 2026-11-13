/** A glass control: it gives a little under the thumb, with a tap you can feel. */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { GlassKind } from '@shared/glass/styles';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';

interface Props {
    kind?: GlassKind;
    radius?: number;
    onPress?: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    /** The glass itself: its padding, size and layout. */
    contentStyle?: StyleProp<ViewStyle>;
    children?: ReactNode;
}

const SPRING = { damping: 16, stiffness: 420, mass: 0.6 };

export function tap() {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
}

export function GlassButton({ kind = 'thin', radius = 999, onPress, accessibilityLabel, disabled, style, contentStyle, children }: Props) {
    const { calm } = useLook();
    const scale = useSharedValue(1);
    const pressed = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    return (
        <Animated.View style={[pressed, style, disabled ? { opacity: 0.5 } : null]}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPressIn={() => {
                    if (!calm) scale.set(withSpring(0.95, SPRING));
                }}
                onPressOut={() => {
                    scale.set(withSpring(1, SPRING));
                }}
                onPress={() => {
                    tap();
                    onPress?.();
                }}
            >
                <GlassSurface kind={kind} radius={radius} style={[{ alignItems: 'center', justifyContent: 'center' }, contentStyle]}>
                    {children}
                </GlassSurface>
            </Pressable>
        </Animated.View>
    );
}
