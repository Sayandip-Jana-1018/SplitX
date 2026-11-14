/** Expenses and payments on one sheet of glass, read left to right like a ledger. An expense opens its detail. */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { ActivityItem } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { categoryEmoji } from './category';
import { EmptyState } from './EmptyState';
import { rupees } from './money';
import { Text } from './Text';
import { when } from './time';

export function ActivityList({ items, showGroup = true }: { items: ActivityItem[]; showGroup?: boolean }) {
    const { tokens } = useLook();
    const { ledger } = useLedger();
    const groupName = (id: string) => ledger.groups.find((group) => group.id === id)?.name ?? '';
    if (items.length === 0) return <EmptyState emoji="🧾" title="Nothing here yet" hint="Expenses and payments show up here as soon as anyone adds one." />;
    return (
        <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {items.map((item, index) => (
                <Pressable
                    key={item.id}
                    disabled={item.kind !== 'expense'}
                    accessibilityRole={item.kind === 'expense' ? 'button' : undefined}
                    onPress={() => router.push(`/expense/${item.id}`)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 14, backgroundColor: pressed ? tokens.chip : 'transparent', borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border })}
                >
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 20, lineHeight: 26 }}>{categoryEmoji(item.category)}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label" align="left" numberOfLines={1}>
                            {item.title}
                        </Text>
                        <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                            {showGroup ? `${groupName(item.groupId)} · ` : ''}
                            {item.note}
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text variant="label" align="right" tone={item.yours > 0 ? 'in' : item.yours < 0 ? 'out' : 'secondary'} tabular>
                            {item.yours === 0 ? 'Not yours' : rupees(item.yours, { sign: true })}
                        </Text>
                        <Text variant="caption" tone="muted" align="right" numberOfLines={1} style={{ alignSelf: 'stretch', minWidth: 72 }}>
                            {when(item.at)}
                        </Text>
                    </View>
                </Pressable>
            ))}
        </GlassSurface>
    );
}
