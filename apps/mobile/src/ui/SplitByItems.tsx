/**
 * A scanned bill split by who had what, as the website's scan page does (src/lib/receiptSplit.ts,
 * the same rules): each item shared equally by the people who had it, and everything else on the
 * bill (taxes, a service charge, a discount, the round-off) shared in proportion to what each
 * person had, so the shares add up exactly to the printed total.
 *
 * Everyone starts on every item, so it can be saved at once; tap a person off an item they didn't
 * have. Saved like any other expense, with exact amounts, and the photo kept as its receipt.
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { ReceiptScan } from '@/lib/contract/v1';
import { splitReceipt } from '@/lib/receiptSplit';
import { ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { knownCategory } from './category';
import { Chips } from './Chips';
import { GlassButton, tap } from './GlassButton';
import { rupees } from './money';
import { Text } from './Text';
import { useToast } from './Toast';

export function SplitByItems({ scan, receipt }: { scan: ReceiptScan; receipt: string }) {
    const { tokens } = useLook();
    const { ledger, personOf, addExpense, setReceipt } = useLedger();
    const toast = useToast();
    const [groupId, setGroupId] = useState(ledger.groups[0]?.id ?? '');
    const group = ledger.groups.find((candidate) => candidate.id === groupId) ?? ledger.groups[0];
    const [payerId, setPayerId] = useState(ME);
    // Who had each item: everyone, until someone is tapped off.
    const [had, setHad] = useState<string[][]>(() => scan.items.map(() => group?.memberIds ?? []));

    const firstName = (id: string) => (id === ME ? 'You' : personOf(id).first);

    const split = useMemo(
        () => (group ? splitReceipt({ items: scan.items, taxes: scan.taxes, total: scan.total, assignments: had, memberIds: group.memberIds }) : null),
        [group, scan, had],
    );

    if (!group) {
        return (
            <GlassSurface style={{ paddingVertical: 20, paddingHorizontal: 18 }}>
                <Text variant="label" tone="secondary">
                    Make a group first: a bill is split among a group’s people.
                </Text>
            </GlassSurface>
        );
    }

    const chooseGroup = (id: string) => {
        const next = ledger.groups.find((candidate) => candidate.id === id);
        if (!next) return;
        setGroupId(id);
        setPayerId(ME);
        setHad(scan.items.map(() => next.memberIds));
    };

    const toggle = (item: number, userId: string) => {
        tap();
        setHad((current) => current.map((people, index) => (index !== item ? people : people.includes(userId) ? people.filter((id) => id !== userId) : group.memberIds.filter((id) => id === userId || people.includes(id)))));
    };

    const nobody = had.findIndex((people) => people.length === 0);

    const save = () => {
        if (!split) return;
        try {
            const added = addExpense({
                groupId: group.id,
                title: scan.merchant ?? 'Bill',
                category: knownCategory(scan.category),
                amount: split.total,
                payerId,
                splitType: 'custom',
                shares: split.shares,
            });
            if (receipt) setReceipt(added.id, receipt);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'That bill could not be saved', 'info');
            return;
        }
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        toast(`Added to ${group.name}`);
        router.replace(`/group/${group.id}`);
    };

    return (
        <>
            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Group
                </Text>
                <Chips label="Group" value={group.id} onChange={chooseGroup} options={ledger.groups.map((candidate) => ({ id: candidate.id, label: candidate.name, emoji: candidate.emoji }))} />
            </View>
            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Paid by
                </Text>
                <Chips label="Paid by" value={payerId} onChange={setPayerId} options={group.memberIds.map((id) => ({ id, label: firstName(id) }))} />
            </View>

            <Text variant="eyebrow" tone="secondary" onLiquid>
                Who had what
            </Text>
            {scan.items.map((item, index) => (
                <GlassSurface key={`${index}-${item.name}`} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                        <Text variant="label" align="left" style={{ flex: 1 }}>
                            {item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name}
                        </Text>
                        <Text variant="label" tabular>
                            {rupees(item.price)}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="none">
                        {group.memberIds.map((id) => {
                            const on = had[index]?.includes(id) ?? false;
                            return (
                                <Pressable
                                    key={id}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: on }}
                                    accessibilityLabel={`${firstName(id)} had ${item.name}`}
                                    onPress={() => toggle(index, id)}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 6,
                                        height: 34,
                                        paddingHorizontal: 12,
                                        borderRadius: 999,
                                        borderWidth: 1.5,
                                        borderColor: on ? tokens.fg : tokens.border,
                                        backgroundColor: on ? tokens.accent : 'transparent',
                                    }}
                                >
                                    <Text variant="caption" weight="bold" tone={on ? 'onAccent' : 'muted'}>
                                        {firstName(id)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </GlassSurface>
            ))}

            <GlassSurface kind="thick" style={{ paddingVertical: 14, paddingHorizontal: 18, gap: 4 }}>
                <Text variant="eyebrow" tone="secondary">
                    Each share, taxes included
                </Text>
                {split ? (
                    split.shares.map((share) => (
                        <View key={share.userId} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 4 }}>
                            <Text variant="label" align="left" style={{ flex: 1 }}>
                                {firstName(share.userId)}
                            </Text>
                            <Text variant="label" weight="bold" tabular>
                                {rupees(share.amount)}
                            </Text>
                        </View>
                    ))
                ) : (
                    <Text variant="caption" tone="secondary">
                        {nobody >= 0 ? `Pick who had ${scan.items[nobody].name}` : 'This bill can’t be split by item'}
                    </Text>
                )}
            </GlassSurface>

            <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!split} onPress={save} accessibilityLabel={split ? `Add ${rupees(split.total)} to ${group.name}` : 'Add the bill'}>
                <Text variant="heading" tone="onAccent">
                    {split ? `Add ${rupees(split.total)} to ${group.name}` : 'Add the bill'}
                </Text>
            </GlassButton>
        </>
    );
}
