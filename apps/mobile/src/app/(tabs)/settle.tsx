/**
 * Settle up, as on the website: the fewest payments that clear each group (the settlement planner),
 * a map of who pays whom, your payments to make and to receive, and the ones already settled.
 *
 * Every answer is saved on the phone first and sent when it can be: confirming a payment made to
 * you, sending it back when it hasn't arrived, and cash handed to you. A payment you make opens Pay.
 */
import { router } from 'expo-router';
import { Banknote, Check, Undo2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { isAwaitingReceiverApproval, isCompletedSettlementStatus, isPendingSettlementStatus } from '@/lib/settlementStatus';
import { groupTransfers, ME, type Settlement } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { Chips } from '~/ui/Chips';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { SettledUp } from '~/ui/SettledUp';
import { SettleMap } from '~/ui/SettleMap';
import { SyncNote } from '~/ui/SyncNote';
import { Text } from '~/ui/Text';
import { TopBar } from '~/ui/TopBar';
import { useToast } from '~/ui/Toast';
import { when } from '~/ui/time';

const ALL = 'all';
const firstName = (name: string) => name.split(' ')[0];

type View_ = 'pending' | 'settled';

export default function Settle() {
    const { tokens } = useLook();
    const { ledger, onRefresh, real, sendMessage, answerPayment, receivedCash, personOf } = useLedger();
    const toast = useToast();
    const [picked, setPicked] = useState<string | null>(null);
    const [view, setView] = useState<View_>('pending');

    // Each group's payments, worked out once.
    const plans = useMemo(() => new Map(ledger.groups.map((group) => [group.id, groupTransfers(ledger, group.id)])), [ledger]);

    // Opens on the first group you have something to settle in, as the website does; else everything.
    const scope = picked && (picked === ALL || plans.has(picked)) ? picked : (ledger.groups.find((group) => plans.get(group.id)?.some((t) => t.from === ME || t.to === ME))?.id ?? ALL);
    const inScope = scope === ALL ? ledger.groups : ledger.groups.filter((group) => group.id === scope);
    const active = scope === ALL ? null : (inScope[0] ?? null);

    const mine = useMemo(
        () =>
            inScope.flatMap((group) =>
                (plans.get(group.id) ?? [])
                    .filter((transfer) => transfer.from === ME || transfer.to === ME)
                    .map((transfer) => ({
                        ...transfer,
                        groupId: group.id,
                        groupName: group.name,
                        // The newest payment between them still open: marked as paid, or on its way.
                        open: ledger.settlements
                            .filter((s) => s.groupId === group.id && s.fromId === transfer.from && s.toId === transfer.to && isPendingSettlementStatus(s.status))
                            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
                    })),
            ),
        [inScope, plans, ledger.settlements],
    );

    const settled = useMemo(
        () =>
            ledger.settlements
                .filter((s) => (s.fromId === ME || s.toId === ME) && isCompletedSettlementStatus(s.status) && inScope.some((group) => group.id === s.groupId))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        [ledger.settlements, inScope],
    );

    const youOwe = mine.filter((t) => t.from === ME).reduce((sum, t) => sum + t.amount, 0);
    const owedToYou = mine.filter((t) => t.to === ME).reduce((sum, t) => sum + t.amount, 0);

    const map = useMemo(() => {
        if (!active) return null;
        const payments = plans.get(active.id) ?? [];
        if (payments.length === 0) return null;
        const ids = [...new Set(payments.flatMap((p) => [p.from, p.to]))];
        // You first, then the rest as the group lists them, so the map keeps its shape between visits.
        const order = [ME, ...active.memberIds];
        ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return { people: ids.map((id) => ({ id, name: id === ME ? 'You' : personOf(id).name })), payments: payments.map((p) => ({ from: p.from, to: p.to, amount: p.amount })) };
    }, [active, plans, personOf]);

    const remind = (transfer: (typeof mine)[number]) => {
        const first = firstName(transfer.fromName);
        if (!real) return toast(`${first} is made up, so no reminder goes anywhere`, 'info');
        sendMessage(transfer.groupId, `A friendly reminder: ${rupees(transfer.amount)} for ${transfer.groupName}. Pay me back when you can 🙂`, transfer.from);
        toast(`Reminded ${first}`);
    };

    const gotCash = (transfer: (typeof mine)[number]) => {
        const first = firstName(transfer.fromName);
        Alert.alert(`${first} paid you in cash?`, `${rupees(transfer.amount)} for ${transfer.groupName}. What ${first} owes you there is cleared, and they see it.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Yes, I got it',
                onPress: () => {
                    // A payment they already started is the one taken as cash; otherwise one is recorded.
                    if (transfer.open) answerPayment(transfer.open.id, 'accept_cash');
                    else receivedCash({ groupId: transfer.groupId, fromId: transfer.from, amount: transfer.amount });
                    toast(`Cash from ${first} recorded`);
                },
            },
        ]);
    };

    const confirm = (open: Settlement, first: string) => {
        answerPayment(open.id, 'approve');
        toast(`Confirmed. ${first}’s payment is in`);
    };

    const notYet = (open: Settlement, first: string) => {
        Alert.alert(`Not in your account yet?`, `${first} is told it hasn’t reached you, and can try again.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Send it back',
                style: 'destructive',
                onPress: () => {
                    answerPayment(open.id, 'send_back');
                    toast(`Sent back to ${first}`, 'info');
                },
            },
        ]);
    };

    const chips = [{ id: ALL, label: 'All groups' }, ...ledger.groups.map((group) => ({ id: group.id, label: group.name, emoji: group.emoji }))];

    return (
        <Screen onRefresh={onRefresh}>
            <TopBar />
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Fewest payments
                </Text>
                <Text variant="display" onLiquid>
                    Settle up
                </Text>
            </View>

            <SyncNote />

            {ledger.groups.length > 1 ? <Chips rail label="Which group" options={chips} value={scope} onChange={setPicked} /> : null}

            <View style={{ flexDirection: 'row', gap: 12 }}>
                <GlassSurface style={{ flex: 1, paddingVertical: 18, gap: 4 }}>
                    <Text variant="caption" tone="secondary">
                        You owe
                    </Text>
                    <RollingAmount paise={youOwe} variant="title" tone="out" />
                </GlassSurface>
                <GlassSurface kind="accent" style={{ flex: 1, paddingVertical: 18, gap: 4 }}>
                    <Text variant="caption" tone="onAccent">
                        Owed to you
                    </Text>
                    <RollingAmount paise={owedToYou} variant="title" tone="onAccent" />
                </GlassSurface>
            </View>

            {map && active ? (
                <GlassSurface style={{ paddingTop: 18, paddingBottom: 16, paddingHorizontal: 12, gap: 4 }}>
                    <Text variant="heading">Money flow</Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {active.emoji} {active.name}
                    </Text>
                    <SettleMap people={map.people} payments={map.payments} />
                </GlassSurface>
            ) : null}

            <Segmented
                options={[
                    { id: 'pending', label: mine.length ? `To settle · ${mine.length}` : 'To settle' },
                    { id: 'settled', label: settled.length ? `Settled · ${settled.length}` : 'Settled' },
                ]}
                value={view}
                onChange={setView}
            />

            {view === 'pending' ? (
                mine.length === 0 ? (
                    <SettledUp hint={scope === ALL ? 'Nobody owes anybody in your groups. Enjoy it.' : 'Nothing between you and anyone here. Enjoy it.'} />
                ) : (
                    <GlassSurface style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                        {mine.map((transfer, index) => {
                            const youPay = transfer.from === ME;
                            const other = youPay ? transfer.toName : transfer.fromName;
                            const first = firstName(other);
                            const sent = youPay && transfer.open && isAwaitingReceiverApproval(transfer.open.status) ? transfer.open : null;
                            const toConfirm = !youPay && transfer.open && !transfer.open.pending && isAwaitingReceiverApproval(transfer.open.status) ? transfer.open : null;
                            return (
                                <View key={`${transfer.groupId}-${transfer.from}-${transfer.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                    <Avatar name={other} size={42} />
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text variant="label" align="left" numberOfLines={1}>
                                            {youPay ? `You pay ${first}` : `${first} pays you`}
                                        </Text>
                                        <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                                            <Text variant="caption" weight="bold" tone={youPay ? 'out' : 'in'} tabular>
                                                {rupees(transfer.amount)}
                                            </Text>
                                            {sent ? ' · sent, waiting' : toConfirm ? ' · says they paid' : scope === ALL ? ` · ${transfer.groupName}` : ''}
                                        </Text>
                                    </View>
                                    {sent ? (
                                        <GlassSurface kind="clear" radius={999} style={{ height: 36, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                            <Check size={14} color={tokens.muted} strokeWidth={2.6} />
                                            <Text variant="caption" weight="bold" tone="muted">
                                                Sent
                                            </Text>
                                        </GlassSurface>
                                    ) : youPay ? (
                                        <GlassButton kind="accent" contentStyle={{ height: 36, paddingHorizontal: 20 }} onPress={() => router.push({ pathname: '/pay', params: { group: transfer.groupId, to: transfer.to, amount: String(transfer.amount) } })}>
                                            <Text variant="caption" weight="bold" tone="onAccent">
                                                Pay
                                            </Text>
                                        </GlassButton>
                                    ) : (
                                        <View style={{ flexDirection: 'row', gap: 8 }}>
                                            <GlassButton kind={toConfirm ? 'accent' : 'thin'} contentStyle={{ height: 36, paddingHorizontal: 16 }} onPress={() => (toConfirm ? confirm(toConfirm, first) : remind(transfer))}>
                                                <Text variant="caption" weight="bold" tone={toConfirm ? 'onAccent' : 'primary'}>
                                                    {toConfirm ? 'Confirm' : 'Remind'}
                                                </Text>
                                            </GlassButton>
                                            <GlassButton
                                                kind="thin"
                                                contentStyle={{ width: 36, height: 36 }}
                                                accessibilityLabel={toConfirm ? `Not yet: send ${first}'s payment back` : `${first} paid you in cash`}
                                                onPress={() => (toConfirm ? notYet(toConfirm, first) : gotCash(transfer))}
                                            >
                                                {toConfirm ? <Undo2 size={17} color={tokens.fg} strokeWidth={2.2} /> : <Banknote size={17} color={tokens.fg} strokeWidth={2.2} />}
                                            </GlassButton>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </GlassSurface>
                )
            ) : settled.length === 0 ? (
                <EmptyState emoji="🧾" title="Nothing settled yet" hint="Payments you make and confirm show here, with how and when." />
            ) : (
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {settled.map((s, index) => {
                        const youPaid = s.fromId === ME;
                        const other = personOf(youPaid ? s.toId : s.fromId).name;
                        const group = ledger.groups.find((candidate) => candidate.id === s.groupId);
                        return (
                            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                <Avatar name={other} size={38} />
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text variant="label" align="left" numberOfLines={1}>
                                        {youPaid ? `You paid ${firstName(other)}` : `${firstName(other)} paid you`}
                                    </Text>
                                    <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                                        {[s.method === 'cash' ? 'Cash' : 'UPI', when(s.createdAt), scope === ALL ? group?.name : null].filter(Boolean).join(' · ')}
                                    </Text>
                                </View>
                                <Text variant="label" tone={youPaid ? 'out' : 'in'} tabular>
                                    {rupees(s.amount)}
                                </Text>
                            </View>
                        );
                    })}
                </GlassSurface>
            )}
        </Screen>
    );
}
