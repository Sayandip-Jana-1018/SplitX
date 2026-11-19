/**
 * Every expense and payment across your groups, newest first, as the website's expense list has
 * them: search by name, group, person or category; the newest or the biggest first; one category
 * at a time. Tap one to see it, change it or delete it.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { activity } from '~/data/ledger';
import { categoriesUsed, findActivity, type Order } from '~/data/find';
import { useLedger } from '~/data/LedgerProvider';
import { ActivityList } from '~/ui/ActivityList';
import { categoryEmoji, categoryLabel, knownCategory } from '~/ui/category';
import { Chips } from '~/ui/Chips';
import { EmptyState } from '~/ui/EmptyState';
import { Field } from '~/ui/Field';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { SyncNote } from '~/ui/SyncNote';
import { Text } from '~/ui/Text';
import { TopBar } from '~/ui/TopBar';

const ALL = 'all';

export default function Activity() {
    const { ledger, onRefresh } = useLedger();
    const [query, setQuery] = useState('');
    const [order, setOrder] = useState<Order>('recent');
    const [category, setCategory] = useState<string>(ALL);

    const items = useMemo(() => activity(ledger), [ledger]);
    // Every category used, most used first, in one row that scrolls.
    const used = useMemo(() => categoriesUsed(items, knownCategory), [items]);
    // A category no expense uses any more (the last one was deleted) stops being a filter.
    const chosen = category !== ALL && used.includes(category) ? category : null;
    const groupName = useMemo(() => {
        const names = new Map(ledger.groups.map((group) => [group.id, group.name]));
        return (id: string) => names.get(id) ?? '';
    }, [ledger.groups]);
    const found = useMemo(() => findActivity(items, { query, category: chosen, order }, groupName, categoryLabel, knownCategory), [items, query, chosen, order, groupName]);

    const filtering = query.trim() !== '' || chosen !== null;
    const expenses = found.filter((item) => item.kind === 'expense');
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);

    return (
        <Screen onRefresh={onRefresh}>
            <TopBar />
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Every rupee, accounted for
                </Text>
                <Text variant="display" onLiquid>
                    Activity
                </Text>
            </View>

            <SyncNote />

            {items.length > 0 ? (
                <>
                    <Field label="Search expenses, people, groups" value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" />
                    <Segmented
                        options={[
                            { id: 'recent', label: 'Newest' },
                            { id: 'highest', label: 'Biggest' },
                        ]}
                        value={order}
                        onChange={setOrder}
                    />
                    {used.length > 1 ? (
                        <Chips rail label="Category" options={[{ id: ALL, label: 'All' }, ...used.map((id) => ({ id, label: categoryLabel(id), emoji: categoryEmoji(id) }))]} value={chosen ?? ALL} onChange={setCategory} />
                    ) : null}
                    {filtering ? (
                        <Text variant="caption" tone="secondary" onLiquid tabular accessibilityLiveRegion="polite">
                            {expenses.length === 1 ? '1 expense' : `${expenses.length} expenses`} · {rupees(total)}
                        </Text>
                    ) : null}
                </>
            ) : null}

            {filtering && found.length === 0 ? <EmptyState emoji="🔍" title="Nothing matches" hint="Try another word, or another category." /> : <ActivityList items={found} byDay={order === 'recent'} />}
        </Screen>
    );
}
