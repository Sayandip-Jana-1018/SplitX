/** Where the money went: by category and by group, either your own share or everyone's. */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { categoryEmoji, categoryLabel } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { Text } from '~/ui/Text';

type Basis = 'mine' | 'everyone';

/** A bar that grows to its share when it appears. */
function Bar({ fraction }: { fraction: number }) {
    const { tokens, calm } = useLook();
    const width = useSharedValue(calm ? fraction : 0);
    useEffect(() => {
        width.value = calm ? fraction : withTiming(fraction, { duration: 700, easing: Easing.out(Easing.cubic) });
    }, [fraction, calm, width]);
    const fill = useAnimatedStyle(() => ({ width: `${Math.max(width.value * 100, 2)}%` }));
    return (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: tokens.chip, overflow: 'hidden' }}>
            <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: tokens.accent }, fill]} />
        </View>
    );
}

export default function Insights() {
    const { tokens } = useLook();
    const { ledger } = useLedger();
    const [basis, setBasis] = useState<Basis>('mine');

    const { byCategory, byGroup, total } = useMemo(() => {
        const amountOf = (expense: (typeof ledger.expenses)[number]) => (basis === 'mine' ? (expense.splits.find((split) => split.userId === ME)?.amount ?? 0) : expense.amount);
        const categories = new Map<string, number>();
        const groups = new Map<string, number>();
        let sum = 0;
        for (const expense of ledger.expenses) {
            const amount = amountOf(expense);
            if (amount <= 0) continue;
            sum += amount;
            categories.set(expense.category, (categories.get(expense.category) ?? 0) + amount);
            groups.set(expense.groupId, (groups.get(expense.groupId) ?? 0) + amount);
        }
        const sorted = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]);
        return { byCategory: sorted(categories), byGroup: sorted(groups), total: sum };
    }, [ledger, basis]);

    const rows = (entries: [string, number][], describe: (id: string) => { emoji: string; label: string }) => (
        <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            {entries.map(([id, amount], index) => {
                const { emoji, label } = describe(id);
                const fraction = total > 0 ? amount / total : 0;
                return (
                    <View key={id} style={{ gap: 8, paddingVertical: 12, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={{ fontSize: 18, lineHeight: 22 }}>{emoji}</Text>
                            <Text variant="label" align="left" style={{ flex: 1 }} numberOfLines={1}>
                                {label}
                            </Text>
                            <Text variant="caption" tone="muted" tabular>
                                {Math.round(fraction * 100)}%
                            </Text>
                            <Text variant="label" tabular style={{ minWidth: 92 }} align="right">
                                {rupees(amount)}
                            </Text>
                        </View>
                        <Bar fraction={fraction} />
                    </View>
                );
            })}
        </GlassSurface>
    );

    return (
        <Screen tabBar={false}>
            <Header title="Insights" eyebrow="Where the money went" />

            <Segmented<Basis>
                options={[
                    { id: 'mine', label: 'Your share' },
                    { id: 'everyone', label: 'Everyone' },
                ]}
                value={basis}
                onChange={setBasis}
            />

            <GlassSurface kind="thick" style={{ paddingVertical: 20, gap: 6 }}>
                <Text variant="eyebrow" tone="secondary">
                    {basis === 'mine' ? 'Your share of everything' : 'Spent together'}
                </Text>
                <RollingAmount paise={total} variant="display" weight="semibold" />
                <Text variant="caption" tone="secondary">
                    across {ledger.groups.length} groups and {ledger.expenses.length} expenses
                </Text>
            </GlassSurface>

            {total === 0 ? (
                <EmptyState emoji="📊" title="Nothing to show yet" hint="Add an expense and it lands here, sorted by what it was for." />
            ) : (
                <>
                    <Text variant="eyebrow" tone="secondary" onLiquid>
                        By category
                    </Text>
                    {rows(byCategory, (id) => ({ emoji: categoryEmoji(id), label: categoryLabel(id) }))}
                    <Text variant="eyebrow" tone="secondary" onLiquid>
                        By group
                    </Text>
                    {rows(byGroup, (id) => {
                        const group = ledger.groups.find((candidate) => candidate.id === id);
                        return { emoji: group?.emoji ?? '👥', label: group?.name ?? 'Former group' };
                    })}
                </>
            )}
        </Screen>
    );
}
