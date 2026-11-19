/**
 * One group: where everyone stands, who pays whom, its expenses and its people, with the way to its
 * Balance Journey and its receipts. Its admin can remove someone who is square, and delete the
 * group once everyone is (the server checks both again).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, MessageCircle, Plus, Trash2, UserPlus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import { isPendingSettlementStatus } from '@/lib/settlementStatus';
import { api } from '~/api';
import { authErrorMessage } from '~/auth/AuthProvider';
import { activity, groupBalances, groupTransfers, ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { ActivityList } from '~/ui/ActivityList';
import { Avatar } from '~/ui/Avatar';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { members, rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Tab = 'overview' | 'expenses' | 'members';

export default function GroupScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { tokens } = useLook();
    const { ledger, personOf, onRefresh, real, removeMember, deleteGroup } = useLedger();
    const toast = useToast();
    const [inviting, setInviting] = useState(false);
    const [tab, setTab] = useState<Tab>('overview');
    const group = ledger.groups.find((candidate) => candidate.id === id);
    const balances = useMemo(() => (group ? groupBalances(ledger, group.id) : {}), [ledger, group]);
    const transfers = useMemo(() => (group ? groupTransfers(ledger, group.id) : []), [ledger, group]);
    const items = useMemo(() => (group ? activity(ledger, group.id) : []), [ledger, group]);

    if (!group) {
        return (
            <Screen tabBar={false}>
                <Header title="Group" />
                <EmptyState emoji="🧭" title="This group isn't here" hint="It may have been deleted, or the link is wrong." />
            </Screen>
        );
    }

    const spent = ledger.expenses.filter((expense) => expense.groupId === group.id).reduce((sum, expense) => sum + expense.amount, 0);

    // The link already out is kept while it works (a new one would end it for everyone it was sent to).
    const invite = async () => {
        setInviting(true);
        try {
            const link = await api.inviteLink(group.id);
            await Share.share({ message: `Join “${group.name}” on SplitIT to split what we spend: ${link.url}` });
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setInviting(false);
        }
    };
    const inviteButton = real ? (
        <GlassButton kind={group.memberIds.length === 1 ? 'accent' : 'thin'} contentStyle={{ height: 50, flexDirection: 'row', gap: 8 }} disabled={inviting} onPress={() => void invite()}>
            <UserPlus size={18} color={group.memberIds.length === 1 ? tokens.onAccent : tokens.fg} strokeWidth={2.4} />
            <Text variant="label" tone={group.memberIds.length === 1 ? 'onAccent' : 'primary'}>
                {inviting ? 'Getting the link…' : 'Invite people'}
            </Text>
        </GlassButton>
    ) : null;
    const mine = balances[ME] ?? 0;
    // Yours to run: a group you made (the demo's made-up groups count as yours).
    const yours = !group.ownerId || group.ownerId === ME;
    const waiting = ledger.settlements.some((s) => s.groupId === group.id && isPendingSettlementStatus(s.status));
    const allSquare = Object.values(balances).every((amount) => amount === 0) && !waiting;
    const receipts = ledger.expenses.filter((expense) => expense.groupId === group.id && expense.receipt).length;

    const remove = (memberId: string) => {
        const first = personOf(memberId).first;
        Alert.alert(`Remove ${first} from ${group.name}?`, `${first} is all square here. Their past expenses stay in the group’s history, and the old invite link stops working.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => {
                    removeMember(group.id, memberId)
                        .then(() => toast(`${first} was removed`))
                        .catch((error: unknown) => toast(error instanceof Error && !real ? error.message : authErrorMessage(error), 'info'));
                },
            },
        ]);
    };

    const deleteIt = () => {
        Alert.alert(`Delete ${group.name}?`, 'Everyone is square, so nothing owed is lost. The group and its expenses go for everyone, and they are told.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                    deleteGroup(group.id)
                        .then(() => {
                            toast(`${group.name} was deleted`);
                            router.replace('/groups');
                        })
                        .catch((error: unknown) => toast(error instanceof Error && !real ? error.message : authErrorMessage(error), 'info'));
                },
            },
        ]);
    };

    return (
        <Screen tabBar={false} onRefresh={onRefresh}>
            <Header title={`${group.emoji} ${group.name}`} eyebrow={members(group.memberIds.length)} />

            <GlassSurface kind="thick" style={{ paddingVertical: 20, gap: 6 }}>
                <Text variant="eyebrow" tone="secondary">
                    {mine === 0 ? 'You are all square' : mine > 0 ? 'You get back' : 'You owe'}
                </Text>
                <RollingAmount paise={Math.abs(mine)} variant="display" weight="semibold" tone={mine >= 0 ? 'in' : 'out'} />
                <Text variant="caption" tone="secondary" tabular>
                    {rupees(spent)} spent together
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 6 }}>
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/journey', params: { group: group.id } })} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text variant="caption" weight="bold" tone="accent">
                            How you got here
                        </Text>
                        <ChevronRight size={14} color={tokens.accentText} strokeWidth={2.6} />
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/receipts/${group.id}`)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text variant="caption" weight="bold" tone="accent">
                            {receipts > 0 ? `Receipts · ${receipts}` : 'Receipts'}
                        </Text>
                        <ChevronRight size={14} color={tokens.accentText} strokeWidth={2.6} />
                    </Pressable>
                </View>
            </GlassSurface>

            <View style={{ flexDirection: 'row', gap: 12 }}>
                <GlassButton kind="accent" style={{ flex: 1.6 }} contentStyle={{ height: 54, flexDirection: 'row', gap: 8 }} onPress={() => router.push({ pathname: '/add', params: { group: group.id } })}>
                    <Plus size={20} color={tokens.onAccent} strokeWidth={2.6} />
                    <Text variant="heading" tone="onAccent">
                        Add expense
                    </Text>
                </GlassButton>
                <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 54, flexDirection: 'row', gap: 8 }} accessibilityLabel="Group chat" onPress={() => router.push(`/chat/${group.id}`)}>
                    <MessageCircle size={19} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="heading">Chat</Text>
                </GlassButton>
            </View>

            <Segmented<Tab>
                options={[
                    { id: 'overview', label: 'Who pays' },
                    { id: 'expenses', label: 'Expenses' },
                    { id: 'members', label: 'Members' },
                ]}
                value={tab}
                onChange={setTab}
            />

            {tab === 'overview' &&
                (transfers.length === 0 ? (
                    <EmptyState emoji="🎉" title="All settled up" hint="Nobody owes anybody in this group." />
                ) : (
                    <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                        {transfers.map((transfer, index) => (
                            <View key={`${transfer.from}-${transfer.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                {/* The other person in it (the payer when it isn't you), as on Settle up. */}
                                <Avatar name={transfer.from === ME ? transfer.toName : transfer.fromName} size={40} />
                                <View style={{ flex: 1 }}>
                                    <Text variant="label" align="left" numberOfLines={1}>
                                        {transfer.from === ME ? `You pay ${transfer.toName.split(' ')[0]}` : `${transfer.fromName.split(' ')[0]} pays ${transfer.to === ME ? 'you' : transfer.toName.split(' ')[0]}`}
                                    </Text>
                                </View>
                                <Text variant="label" tabular tone={transfer.to === ME ? 'in' : transfer.from === ME ? 'out' : 'secondary'}>
                                    {rupees(transfer.amount)}
                                </Text>
                            </View>
                        ))}
                    </GlassSurface>
                ))}

            {tab === 'expenses' && (items.length === 0 ? <EmptyState emoji="🧾" title="No expenses yet" hint="Add the first one, and everyone's share is worked out for you." /> : <ActivityList items={items} showGroup={false} />)}

            {tab === 'members' && (
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {group.memberIds.map((memberId, index) => {
                        const person = personOf(memberId);
                        const balance = balances[memberId] ?? 0;
                        return (
                            <View key={memberId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                <Avatar name={person.name} size={40} />
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text variant="label" align="left">
                                        {memberId === ME ? `${person.name} (you)` : person.name}
                                    </Text>
                                    <Text variant="caption" tone="secondary" align="left">
                                        {balance === 0 ? 'All square' : balance > 0 ? 'Gets back' : 'Owes'}
                                    </Text>
                                </View>
                                {yours && memberId !== ME && memberId !== group.ownerId && balance === 0 ? (
                                    <GlassButton kind="thin" contentStyle={{ height: 34, paddingHorizontal: 14 }} accessibilityLabel={`Remove ${person.name}`} onPress={() => remove(memberId)}>
                                        <Text variant="caption" weight="bold" tone="danger">
                                            Remove
                                        </Text>
                                    </GlassButton>
                                ) : (
                                    <Text variant="label" tabular tone={balance >= 0 ? 'in' : 'out'}>
                                        {rupees(Math.abs(balance))}
                                    </Text>
                                )}
                            </View>
                        );
                    })}
                </GlassSurface>
            )}
            {tab === 'members' || group.memberIds.length === 1 ? inviteButton : null}
            {tab === 'members' && yours ? (
                <View style={{ gap: 8 }}>
                    <GlassButton kind="thin" disabled={!allSquare} contentStyle={{ height: 50, flexDirection: 'row', gap: 8 }} onPress={deleteIt}>
                        <Trash2 size={17} color={tokens.danger} strokeWidth={2.2} />
                        <Text variant="label" tone="danger">
                            Delete group
                        </Text>
                    </GlassButton>
                    {allSquare ? null : (
                        <Text variant="caption" tone="secondary" onLiquid>
                            {waiting ? 'A payment here is still waiting. Once it’s done, the group can be deleted.' : 'Once everyone here is square, the group can be deleted.'}
                        </Text>
                    )}
                </View>
            ) : null}
        </Screen>
    );
}
