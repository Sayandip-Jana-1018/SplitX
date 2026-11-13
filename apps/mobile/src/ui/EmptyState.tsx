/** What a screen says when there's nothing to show yet, and what to do about it. */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { Text } from './Text';

export function EmptyState({ emoji, title, hint, action }: { emoji: string; title: string; hint: string; action?: ReactNode }) {
    return (
        <GlassSurface style={{ paddingVertical: 28, paddingHorizontal: 20, gap: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 34, lineHeight: 42 }}>{emoji}</Text>
            <Text variant="heading">{title}</Text>
            <Text variant="caption" tone="secondary" style={{ maxWidth: 280 }}>
                {hint}
            </Text>
            {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
        </GlassSurface>
    );
}
