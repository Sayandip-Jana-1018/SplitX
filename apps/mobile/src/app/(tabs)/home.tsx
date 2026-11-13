/**
 * Home: your balance on a coin that turns, what you're owed and owe, the four things you do most,
 * your groups, and what happened lately. Every number comes from the ledger.
 */
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChartPie, ChevronRight, Plus, ScanLine, type LucideIcon } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { GlassKind } from '@shared/glass/styles';
import { activity, groupBalances, ME, personById, totals } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { Coin } from '~/glass/Coin';
import { GlassScrollView } from '~/glass/GlassScroll';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { ActivityList } from '~/ui/ActivityList';
import { AvatarStack } from '~/ui/Avatar';
import { GlassButton } from '~/ui/GlassButton';
import { rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen, SectionTitle } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { TopBar } from '~/ui/TopBar';

function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

const ACTIONS: { label: string; icon: LucideIcon; kind: GlassKind; href: string }[] = [
    { label: 'Add', icon: Plus, kind: 'accent', href: '/add' },
    { label: 'Settle', icon: ArrowLeftRight, kind: 'thin', href: '/settle' },
    { label: 'Scan', icon: ScanLine, kind: 'thin', href: '/add' },
    { label: 'Insights', icon: ChartPie, kind: 'thin', href: '/insights' },
];

export default function Home() {
    const { tokens, calm } = useLook();
    const { ledger } = useLedger();
    const { width } = useWindowDimensions();
    const coin = Math.min(width - 56, 310);
    const sum = useMemo(() => totals(ledger), [ledger]);
    const lately = useMemo(() => activity(ledger).slice(0, 3), [ledger]);
    const enter = (index: number) => (calm ? undefined : FadeIn.delay(60 + index * 70).duration(380));
    const owed = sum.net >= 0;
    const Arrow = owed ? ArrowDownLeft : ArrowUpRight;

    return (
        <Screen>
            <TopBar />

            <Animated.View entering={enter(0)} style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="label" tone="secondary" onLiquid>
                    {greeting()}
                </Text>
                <Text variant="display" onLiquid>
                    Hi, {personById(ME).first}
                </Text>
            </Animated.View>

            <Animated.View entering={enter(1)} style={{ alignItems: 'center' }}>
                <Coin kind="rim" size={coin}>
                    <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 24 }}>
                        <Text variant="eyebrow" tone="secondary" onLiquid>
                            {sum.net === 0 ? 'All settled up' : owed ? 'You are owed' : 'You owe'}
                        </Text>
                        <RollingAmount paise={sum.net} sign variant="hero" weight="medium" onLiquid numberOfLines={1} adjustsFontSizeToFit />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityHint="Opens your Balance Journey"
                            onPress={() => router.push('/journey')}
                            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pressed ? tokens.borderStrong : tokens.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 })}
                        >
                            <Arrow size={14} color={tokens.fg} strokeWidth={2.4} />
                            <Text variant="caption" weight="semibold">
                                Across your groups
                            </Text>
                            <ChevronRight size={14} color={tokens.fg} strokeWidth={2.4} />
                        </Pressable>
                    </View>
                </Coin>
            </Animated.View>

            <Animated.View entering={enter(2)} style={{ flexDirection: 'row', gap: 12 }}>
                <GlassSurface style={{ flex: 1, paddingVertical: 16, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        Owed to you
                    </Text>
                    <RollingAmount paise={sum.owedToYou} sign variant="heading" tone="in" />
                </GlassSurface>
                <GlassSurface style={{ flex: 1, paddingVertical: 16, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        You owe
                    </Text>
                    <RollingAmount paise={-sum.youOwe} sign variant="heading" tone="out" />
                </GlassSurface>
            </Animated.View>

            <Animated.View entering={enter(3)} style={{ flexDirection: 'row', gap: 10 }}>
                {ACTIONS.map(({ label, icon: Icon, kind, href }) => (
                    <GlassButton key={label} kind={kind} radius={22} style={{ flex: 1 }} contentStyle={{ height: 78, gap: 6 }} onPress={() => router.push(href as never)}>
                        <Icon size={22} color={kind === 'accent' ? tokens.onAccent : tokens.fg} strokeWidth={2.2} />
                        <Text variant="caption" weight="bold" tone={kind === 'accent' ? 'onAccent' : 'primary'}>
                            {label}
                        </Text>
                    </GlassButton>
                ))}
            </Animated.View>

            <Animated.View entering={enter(4)} style={{ gap: 14 }}>
                <SectionTitle
                    action={
                        <Pressable onPress={() => router.push('/groups')} hitSlop={12}>
                            <Text variant="label" tone="accent">
                                See all
                            </Text>
                        </Pressable>
                    }
                >
                    <Text variant="heading" onLiquid>
                        Your groups
                    </Text>
                </SectionTitle>
                <GlassScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14, gap: 12 }}>
                    {ledger.groups.map((group) => {
                        const mine = groupBalances(ledger, group.id)[ME] ?? 0;
                        const spent = ledger.expenses.filter((expense) => expense.groupId === group.id).reduce((total, expense) => total + expense.amount, 0);
                        return (
                            <GlassButton key={group.id} kind="reg" radius={24} contentStyle={{ width: 196, paddingVertical: 18, paddingHorizontal: 12, gap: 8 }} onPress={() => router.push(`/group/${group.id}`)}>
                                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ fontSize: 22, lineHeight: 28 }}>{group.emoji}</Text>
                                </View>
                                <Text variant="heading" numberOfLines={1}>
                                    {group.name}
                                </Text>
                                <Text variant="caption" tone="secondary" tabular>
                                    {group.memberIds.length} members · {rupees(spent)}
                                </Text>
                                <AvatarStack names={group.memberIds.map((id) => personById(id).name)} />
                                <Text variant="label" tone={mine >= 0 ? 'in' : 'out'} tabular>
                                    {mine === 0 ? 'Settled' : rupees(mine, { sign: true })}
                                </Text>
                            </GlassButton>
                        );
                    })}
                </GlassScrollView>
            </Animated.View>

            <Animated.View entering={enter(5)} style={{ gap: 14 }}>
                <SectionTitle>
                    <Text variant="heading" onLiquid>
                        Lately
                    </Text>
                </SectionTitle>
                <ActivityList items={lately} />
            </Animated.View>
        </Screen>
    );
}
