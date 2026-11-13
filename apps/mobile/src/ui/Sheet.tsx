/**
 * A sheet of glass that rises from the bottom over a dimmed screen, for a choice or a question.
 * Drag it down, tap outside it, or press back to close it.
 *
 * The glass inside it is told how far the sheet has slid (through the same context a scroll
 * uses), so it shows the liquid that is really behind it at every moment of the slide.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { GlassSurface } from '~/glass/GlassSurface';
import { ScrollContext } from '~/glass/origin';
import { useLook } from '~/theme/ThemeProvider';
import { Text } from './Text';

const RISE = { damping: 22, stiffness: 240, mass: 0.9 };

export function Sheet({ open, onClose, title, hint, children }: { open: boolean; onClose: () => void; title: string; hint?: string; children: ReactNode }) {
    const { tokens, calm } = useLook();
    const { height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    // Closing keeps the sheet on screen until it has slid away.
    const [wasOpen, setWasOpen] = useState(open);
    const [closing, setClosing] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        setClosing(!open && !calm);
    }
    const shown = open || closing;
    const drop = useSharedValue(height);
    const lift = useDerivedValue(() => -drop.value);

    useEffect(() => {
        if (open) drop.set(calm ? 0 : withSpring(0, RISE));
        else if (calm) drop.set(height);
        else
            drop.set(
                withTiming(height, { duration: 220 }, (finished) => {
                    if (finished) scheduleOnRN(setClosing, false);
                }),
            );
    }, [open, calm, height, drop]);

    useEffect(() => {
        if (!open) return;
        const back = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose();
            return true;
        });
        return () => back.remove();
    }, [open, onClose]);

    const drag = Gesture.Pan()
        .activeOffsetY(8)
        .onUpdate((event) => {
            drop.set(Math.max(0, event.translationY));
        })
        .onEnd((event) => {
            if (event.translationY > 110 || event.velocityY > 900) scheduleOnRN(onClose);
            else drop.set(withSpring(0, RISE));
        });

    const dim = useAnimatedStyle(() => ({ opacity: interpolate(drop.value, [0, height * 0.6], [1, 0], 'clamp') }));
    const slide = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value }] }));

    if (!shown) return null;
    return (
        <View style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, dim]}>
                <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
            </Animated.View>
            <GestureDetector gesture={drag}>
                <Animated.View accessibilityViewIsModal style={[{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 12 }, slide]}>
                    <ScrollContext.Provider value={{ y: lift }}>
                        <GlassSurface kind="thick" radius={32} style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, gap: 14 }}>
                            <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: tokens.borderStrong }} />
                            <View style={{ gap: 4 }}>
                                <Text variant="heading">{title}</Text>
                                {hint ? (
                                    <Text variant="caption" tone="secondary">
                                        {hint}
                                    </Text>
                                ) : null}
                            </View>
                            {children}
                        </GlassSurface>
                    </ScrollContext.Provider>
                </Animated.View>
            </GestureDetector>
        </View>
    );
}
