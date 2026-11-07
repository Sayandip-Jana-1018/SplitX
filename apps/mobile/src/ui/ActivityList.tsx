/** A list of expenses and payments on one sheet of glass, readable left to right like a ledger. */
import { View } from 'react-native';
import type { DemoActivity } from '~/data/demo';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { rupees } from './money';
import { Text } from './Text';

export function ActivityList({ items }: { items: DemoActivity[] }) {
    const { tokens } = useLook();
    return (
        <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {items.map((item, index) => (
                <View
                    key={item.id}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 14,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: tokens.border,
                    }}
                >
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 20, lineHeight: 26 }}>{item.emoji}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label" align="left" numberOfLines={1}>
                            {item.title}
                        </Text>
                        <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                            {item.group} · {item.note}
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text variant="label" align="right" tone={item.yourPaise > 0 ? 'in' : item.yourPaise < 0 ? 'out' : 'secondary'} tabular>
                            {item.yourPaise === 0 ? 'Settled' : rupees(item.yourPaise, { sign: true })}
                        </Text>
                        <Text variant="caption" tone="muted" align="right">
                            {item.when}
                        </Text>
                    </View>
                </View>
            ))}
        </GlassSurface>
    );
}
