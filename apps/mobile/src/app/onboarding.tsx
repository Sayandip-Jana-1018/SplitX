/**
 * The first look after Welcome: four short pages, each with a coin, saying what the app does.
 * Swipe or tap Next; Skip goes straight in. Pages fade rather than slide, so the coins' glass
 * always knows where it is on screen.
 */
import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import type { CoinKind } from '@shared/glass/coins';
import { Coin } from '~/glass/Coin';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Text } from '~/ui/Text';

const PAGES: { coin: CoinKind; title: string; body: string }[] = [
    { coin: 'split', title: 'Split anything', body: 'Trips, flats, dinners. Add it once, and everyone’s share is worked out to the paisa.' },
    { coin: 'rim', title: 'Fewest payments', body: 'SplitIT works out who pays whom, so a whole group clears in as few payments as possible.' },
    { coin: 'note', title: 'Pay back by UPI', body: 'One tap opens your UPI app with the amount filled in. Your money never passes through SplitIT.' },
    { coin: 'coin', title: 'Make it yours', body: 'Sixteen colours, light or dark, five kinds of glass. Calm stills everything, any time.' },
];

export default function Onboarding() {
    const { tokens, calm } = useLook();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const [page, setPage] = useState(0);
    const last = page === PAGES.length - 1;
    const coin = Math.min(width * 0.78, height * 0.36, 320);

    const enter = () => {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/home');
    };
    const go = (by: number) => {
        const next = page + by;
        if (next >= PAGES.length) return enter();
        if (next < 0) return;
        tap();
        setPage(next);
    };

    const swipe = Gesture.Pan()
        .activeOffsetX([-20, 20])
        .onEnd((event) => {
            if (event.translationX < -60) scheduleOnRN(go, 1);
            else if (event.translationX > 60) scheduleOnRN(go, -1);
        });

    const { coin: kind, title, body } = PAGES[page];
    return (
        <GestureDetector gesture={swipe}>
            <View style={{ flex: 1, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, alignItems: 'center' }}>
                <View style={{ width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
                        {PAGES.map((entry, index) => (
                            <View key={entry.title} style={{ width: index === page ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: index === page ? tokens.accentText : tokens.borderStrong }} />
                        ))}
                    </View>
                    {last ? null : (
                        <Pressable accessibilityRole="button" onPress={enter} hitSlop={12}>
                            <Text variant="label" tone="secondary" onLiquid>
                                Skip
                            </Text>
                        </Pressable>
                    )}
                </View>

                <View style={{ flex: 1, width: '100%' }}>
                    <Animated.View key={page} entering={calm ? undefined : FadeIn.duration(420)} exiting={calm ? undefined : FadeOut.duration(200)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
                        <Coin kind={kind} size={coin} />
                        <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 8 }}>
                            <Text variant="hero" onLiquid>
                                {title}
                            </Text>
                            <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320 }}>
                                {body}
                            </Text>
                        </View>
                    </Animated.View>
                </View>

                <View style={{ width: '100%', maxWidth: 420, gap: 10 }}>
                    <GlassButton kind="accent" contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} onPress={() => go(1)}>
                        <Text variant="heading" tone="onAccent">
                            {last ? 'Start splitting' : 'Next'}
                        </Text>
                        <ArrowRight size={20} color={tokens.onAccent} strokeWidth={2.4} />
                    </GlassButton>
                    <Text variant="caption" tone="muted" onLiquid>
                        Preview build · the people and money in it are made up
                    </Text>
                </View>
            </View>
        </GestureDetector>
    );
}
