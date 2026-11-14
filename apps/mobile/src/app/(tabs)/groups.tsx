/** Every group and trip you share money in, with where you stand in each. */
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { groupBalances, ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { useLook } from '~/theme/ThemeProvider';
import { AvatarStack } from '~/ui/Avatar';
import { EmptyState } from '~/ui/EmptyState';
import { GroupActions } from '~/ui/GroupActions';
import { GlassButton } from '~/ui/GlassButton';
import { members, rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function Groups() {
    const { tokens, calm } = useLook();
    const { ledger, personOf, onRefresh } = useLedger();
    const total = ledger.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return (
        <Screen onRefresh={onRefresh}>
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Shared spaces
                </Text>
                <Text variant="display" onLiquid>
                    Your groups
                </Text>
                <Text variant="label" tone="secondary" onLiquid tabular>
                    {ledger.groups.length === 1 ? '1 group' : `${ledger.groups.length} groups`} · {rupees(total)} tracked together
                </Text>
            </View>
            <GroupActions />
            {ledger.groups.length === 0 ? <EmptyState emoji="👥" title="No groups yet" hint="Make one for a trip, a flat or a dinner, or join one with the invite link someone sent you." /> : null}
            {ledger.groups.map((group, index) => {
                const mine = groupBalances(ledger, group.id)[ME] ?? 0;
                return (
                    <Animated.View key={group.id} entering={calm ? undefined : FadeIn.delay(60 + index * 70).duration(380)}>
                        <GlassButton kind="reg" radius={24} contentStyle={{ padding: 16, gap: 14, alignItems: 'stretch' }} onPress={() => router.push(`/group/${group.id}`)}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ fontSize: 24, lineHeight: 30 }}>{group.emoji}</Text>
                                </View>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text variant="heading" align="left">
                                        {group.name}
                                    </Text>
                                    <Text variant="caption" tone="secondary" align="left">
                                        {members(group.memberIds.length)}
                                    </Text>
                                </View>
                                <ChevronRight size={20} color={tokens.muted} />
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <AvatarStack names={group.memberIds.map((id) => personOf(id).name)} size={28} />
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text variant="caption" tone="muted" align="right" numberOfLines={1} style={{ alignSelf: 'stretch', minWidth: 80 }}>
                                        {mine === 0 ? 'All square' : mine > 0 ? 'You get back' : 'You owe'}
                                    </Text>
                                    <Text variant="heading" tone={mine >= 0 ? 'in' : 'out'} align="right" tabular>
                                        {rupees(Math.abs(mine))}
                                    </Text>
                                </View>
                            </View>
                        </GlassButton>
                    </Animated.View>
                );
            })}
        </Screen>
    );
}
