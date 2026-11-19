/**
 * One search across your groups, the people in them, and every expense and payment, as the
 * website's search (Ctrl+K) does, with its quick actions before anything is typed. It looks
 * through what's on the phone, so it works offline too.
 */
import { router } from 'expo-router';
import { ArrowLeftRight, ChartPie, ChevronRight, Plus, TrendingUp, Users, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { activity, ME } from '~/data/ledger';
import { findActivity } from '~/data/find';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { ActivityList } from '~/ui/ActivityList';
import { Avatar } from '~/ui/Avatar';
import { categoryLabel } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { Field } from '~/ui/Field';
import { Header } from '~/ui/Header';
import { members } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const QUICK: { title: string; hint: string; icon: LucideIcon; href: string }[] = [
    { title: 'Add an expense', hint: 'Split a new bill with a group', icon: Plus, href: '/add' },
    { title: 'Settle up', hint: 'See who owes whom', icon: ArrowLeftRight, href: '/settle' },
    { title: 'Groups', hint: 'Make one, or join with a link', icon: Users, href: '/groups' },
    { title: 'Balance Journey', hint: 'How your balance got here', icon: TrendingUp, href: '/journey' },
    { title: 'Insights', hint: 'Where the money goes', icon: ChartPie, href: '/insights' },
];

export default function Search() {
    const { tokens } = useLook();
    const { ledger } = useLedger();
    const [query, setQuery] = useState('');
    const words = useMemo(() => plain(query).split(/\s+/).filter(Boolean), [query]);
    const matches = (text: string) => words.every((word) => plain(text).includes(word));

    const groups = words.length === 0 ? [] : ledger.groups.filter((group) => matches(group.name));
    const people =
        words.length === 0
            ? []
            : ledger.people
                  .filter((person) => person.id !== ME && matches(person.name))
                  .map((person) => ({ person, groups: ledger.groups.filter((group) => group.memberIds.includes(person.id)) }))
                  .filter((entry) => entry.groups.length > 0);
    const items = useMemo(() => activity(ledger), [ledger]);
    const groupName = useMemo(() => {
        const names = new Map(ledger.groups.map((group) => [group.id, group.name]));
        return (id: string) => names.get(id) ?? '';
    }, [ledger.groups]);
    const expenses = words.length === 0 ? [] : findActivity(items, { query, category: null, order: 'recent' }, groupName, categoryLabel).slice(0, 20);

    const row = (key: string, onPress: () => void, left: React.ReactNode, title: string, hint: string, index: number) => (
        <Pressable key={key} accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
            {left}
            <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" align="left" numberOfLines={1}>
                    {title}
                </Text>
                <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                    {hint}
                </Text>
            </View>
            <ChevronRight size={18} color={tokens.muted} />
        </Pressable>
    );
    const disc = (children: React.ReactNode) => <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
    const titled = (title: string, children: React.ReactNode) => (
        <View style={{ gap: 10 }}>
            <Text variant="eyebrow" tone="secondary" onLiquid>
                {title}
            </Text>
            {children}
        </View>
    );

    return (
        <Screen tabBar={false}>
            <Header title="Search" />
            <Field label="Search groups, expenses, people" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />

            {words.length === 0 ? (
                titled(
                    'Quick actions',
                    <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                        {QUICK.map((action, index) => {
                            const Icon = action.icon;
                            return row(action.href, () => router.push(action.href as never), disc(<Icon size={19} color={tokens.fg} strokeWidth={2.2} />), action.title, action.hint, index);
                        })}
                    </GlassSurface>,
                )
            ) : groups.length + people.length + expenses.length === 0 ? (
                <EmptyState emoji="🔍" title="Nothing matches" hint="Try a group’s name, a friend’s name, or what an expense was for." />
            ) : (
                <>
                    {groups.length > 0
                        ? titled(
                              'Groups',
                              <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                                  {groups.map((group, index) => row(group.id, () => router.push(`/group/${group.id}`), disc(<Text style={{ fontSize: 20, lineHeight: 26 }}>{group.emoji}</Text>), group.name, members(group.memberIds.length), index))}
                              </GlassSurface>,
                          )
                        : null}
                    {people.length > 0
                        ? titled(
                              'People',
                              <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                                  {people.map(({ person, groups: shared }, index) => row(person.id, () => router.push(`/group/${shared[0].id}`), <Avatar name={person.name} size={40} />, person.name, `In ${shared.map((group) => group.name).join(', ')}`, index))}
                              </GlassSurface>,
                          )
                        : null}
                    {expenses.length > 0 ? titled('Expenses and payments', <ActivityList items={expenses} />) : null}
                </>
            )}
        </Screen>
    );
}
