/** A screen's title, centred, with a way back or a way out beside it. */
import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton } from './GlassButton';
import { Text } from './Text';

export function Header({ title, eyebrow, close, right }: { title: string; eyebrow?: string; close?: boolean; right?: ReactNode }) {
    const { tokens } = useLook();
    const Icon = close ? X : ChevronLeft;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 46 }}>
            <View style={{ position: 'absolute', left: 0 }}>
                <GlassButton kind="thin" contentStyle={{ width: 42, height: 42 }} accessibilityLabel={close ? 'Close' : 'Back'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
                    <Icon size={20} color={tokens.fg} strokeWidth={2.2} />
                </GlassButton>
            </View>
            <View style={{ alignItems: 'center', paddingHorizontal: 56 }}>
                {eyebrow ? (
                    <Text variant="eyebrow" tone="secondary" onLiquid>
                        {eyebrow}
                    </Text>
                ) : null}
                <Text variant="title" onLiquid numberOfLines={1}>
                    {title}
                </Text>
            </View>
            {right ? <View style={{ position: 'absolute', right: 0 }}>{right}</View> : null}
        </View>
    );
}
