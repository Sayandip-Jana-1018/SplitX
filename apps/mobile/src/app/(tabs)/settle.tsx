/** The fewest payments that clear every group, worked out by the settlement planner. */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { groupTransfers, ME, totals } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

export default function Settle() {
    const { tokens } = useLook();
    const { ledger, onRefresh } = useLedger();
    const toast = useToast();
    const sum = useMemo(() => totals(ledger), [ledger]);
    const mine = useMemo(
        () =>
            ledger.groups.flatMap((group) =>
                groupTransfers(ledger, group.id)
                    .filter((transfer) => transfer.from === ME || transfer.to === ME)
                    .map((transfer) => ({ ...transfer, groupId: group.id, groupName: group.name })),
            ),
        [ledger],
    );

    return (
        <Screen onRefresh={onRefresh}>
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Fewest payments
                </Text>
                <Text variant="display" onLiquid>
                    Settle up
                </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                <GlassSurface style={{ flex: 1, paddingVertical: 18, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        You owe
                    </Text>
                    <RollingAmount paise={sum.youOwe} variant="title" tone="out" />
                </GlassSurface>
                <GlassSurface kind="accent" style={{ flex: 1, paddingVertical: 18, gap: 4 }}>
                    <Text variant="caption" tone="onAccent">
                        Owed to you
                    </Text>
                    <RollingAmount paise={sum.owedToYou} variant="title" tone="onAccent" />
                </GlassSurface>
            </View>
            {mine.length === 0 ? (
                <EmptyState emoji="🎉" title="All settled up" hint="Nobody owes anybody in your groups. Enjoy it." />
            ) : (
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {mine.map((transfer, index) => {
                        const youPay = transfer.from === ME;
                        const other = youPay ? transfer.toName : transfer.fromName;
                        return (
                            <View key={`${transfer.groupId}-${transfer.from}-${transfer.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                <Avatar name={other} size={40} />
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text variant="label" align="left" numberOfLines={1}>
                                        {youPay ? `You pay ${other.split(' ')[0]}` : `${other.split(' ')[0]} pays you`}
                                    </Text>
                                    <Text variant="caption" tone="secondary" align="left" tabular>
                                        {transfer.groupName} · {rupees(transfer.amount)}
                                    </Text>
                                </View>
                                <GlassButton
                                    kind={youPay ? 'accent' : 'thin'}
                                    contentStyle={{ paddingHorizontal: 16, height: 38 }}
                                    onPress={() =>
                                        youPay
                                            ? router.push({ pathname: '/pay', params: { group: transfer.groupId, to: transfer.to, amount: String(transfer.amount) } })
                                            : toast(`Reminders reach ${other.split(' ')[0]} once sign-in arrives`, 'info')
                                    }
                                >
                                    <Text variant="caption" weight="bold" tone={youPay ? 'onAccent' : 'primary'}>
                                        {youPay ? 'Pay' : 'Remind'}
                                    </Text>
                                </GlassButton>
                            </View>
                        );
                    })}
                </GlassSurface>
            )}
        </Screen>
    );
}
