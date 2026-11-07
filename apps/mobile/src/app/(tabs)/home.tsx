/**
 * Home: your balance on a coin that turns, what you're owed and owe, the four things you do most,
 * your groups, and what happened lately.
 */
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ChartPie, Plus, ScanLine, type LucideIcon } from 'lucide-react-native';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { GlassKind } from '@shared/glass/styles';
import { ACTIVITY, BALANCE, GROUPS, ME } from '~/data/demo';
import { Coin } from '~/glass/Coin';
import { GlassScrollView } from '~/glass/GlassScroll';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { ActivityList } from '~/ui/ActivityList';
import { AvatarStack } from '~/ui/Avatar';
import { GlassButton } from '~/ui/GlassButton';
import { rupees } from '~/ui/money';
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
    { label: 'Insights', icon: ChartPie, kind: 'thin', href: '/activity' },
];

export default function Home() {
    const { tokens, calm } = useLook();
    const { width } = useWindowDimensions();
    const coin = Math.min(width - 56, 310);
    const enter = (index: number) => (calm ? undefined : FadeInDown.delay(60 + index * 70).springify().damping(18));

    return (
        <Screen>
            <TopBar />

            <Animated.View entering={enter(0)} style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="label" tone="secondary" onLiquid>
                    {greeting()}
                </Text>
                <Text variant="display" onLiquid>
                    Hi, {ME.first}
                </Text>
            </Animated.View>

            <Animated.View entering={enter(1)} style={{ alignItems: 'center' }}>
                <Coin kind="rim" size={coin}>
                    <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 24 }}>
                        <Text variant="eyebrow" tone="secondary" onLiquid>
                            You are owed
                        </Text>
                        <Text variant="hero" weight="medium" onLiquid tabular numberOfLines={1} adjustsFontSizeToFit>
                            {rupees(BALANCE.netPaise, { sign: true })}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: tokens.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                            <ArrowDownLeft size={14} color={tokens.fg} strokeWidth={2.4} />
                            <Text variant="caption" weight="semibold">
                                Across your groups
                            </Text>
                        </View>
                    </View>
                </Coin>
            </Animated.View>

            <Animated.View entering={enter(2)} style={{ flexDirection: 'row', gap: 12 }}>
                <GlassSurface style={{ flex: 1, paddingVertical: 16, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        Owed to you
                    </Text>
                    <Text variant="heading" tone="in" tabular>
                        {rupees(BALANCE.owedToYouPaise, { sign: true })}
                    </Text>
                </GlassSurface>
                <GlassSurface style={{ flex: 1, paddingVertical: 16, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        You owe
                    </Text>
                    <Text variant="heading" tone="out" tabular>
                        {rupees(-BALANCE.youOwePaise, { sign: true })}
                    </Text>
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
                    {GROUPS.map((group) => (
                        <GlassSurface key={group.id} style={{ width: 196, paddingVertical: 18, paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 22, lineHeight: 28 }}>{group.emoji}</Text>
                            </View>
                            <Text variant="heading" numberOfLines={1}>
                                {group.name}
                            </Text>
                            <Text variant="caption" tone="secondary" tabular>
                                {group.members.length} members · {rupees(group.totalPaise)}
                            </Text>
                            <AvatarStack names={group.members} />
                            <Text variant="label" tone={group.yourPaise >= 0 ? 'in' : 'out'} tabular>
                                {rupees(group.yourPaise, { sign: true })}
                            </Text>
                        </GlassSurface>
                    ))}
                </GlassScrollView>
            </Animated.View>

            <Animated.View entering={enter(5)} style={{ gap: 14 }}>
                <SectionTitle>
                    <Text variant="heading" onLiquid>
                        Lately
                    </Text>
                </SectionTitle>
                <ActivityList items={ACTIVITY.slice(0, 3)} />
            </Animated.View>
        </Screen>
    );
}
