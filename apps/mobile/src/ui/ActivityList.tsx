/**
 * Expenses and payments on one sheet of glass, read left to right like a ledger. An expense opens its
 * detail. `byDay`: a sheet per day under its heading (Today, Yesterday, Wednesday…), each row with
 * just its time.
 */
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
import { clock, dayHeading, when } from './time';

export function ActivityList({ items, showGroup = true, byDay = false }: { items: ActivityItem[]; showGroup?: boolean; byDay?: boolean }) {
    if (items.length === 0) return <EmptyState emoji="🧾" title="Nothing here yet" hint="Expenses and payments show up here as soon as anyone adds one." />;
    if (!byDay) return <Sheet items={items} showGroup={showGroup} />;
    // Days in the order the items come (newest first, or biggest first: each day keeps its first place).
    const days: { heading: string; items: ActivityItem[] }[] = [];
    for (const item of items) {
        const heading = dayHeading(item.at);
        const day = days.find((candidate) => candidate.heading === heading);
        if (day) day.items.push(item);
        else days.push({ heading, items: [item] });
    }
    return (
        <View style={{ gap: 18 }}>
            {days.map((day) => (
                <View key={day.heading} style={{ gap: 10 }}>
                    <Text variant="eyebrow" tone="secondary" onLiquid>
                        {day.heading}
                    </Text>
                    <Sheet items={day.items} showGroup={showGroup} timeOnly />
                </View>
            ))}
        </View>
    );
}

function Sheet({ items, showGroup, timeOnly = false }: { items: ActivityItem[]; showGroup: boolean; timeOnly?: boolean }) {
    const { tokens } = useLook();
    const { ledger } = useLedger();
    const groupName = (id: string) => ledger.groups.find((group) => group.id === id)?.name ?? '';
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
                            {timeOnly ? clock(item.at) : when(item.at)}
                        </Text>
                    </View>
                </Pressable>
            ))}
        </GlassSurface>
    );
}
