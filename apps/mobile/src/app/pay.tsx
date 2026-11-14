/**
 * Paying someone back.
 *
 * - **Your real groups:** "Pay with a UPI app" asks the server for the payment and opens your UPI app
 *   with the amount filled in (your money never passes through SplitIT); back here, "I've paid" tells
 *   them. "I paid in cash" works offline: it's saved on the phone and sent when it can be. Either way
 *   they confirm it before balances move, as on the website.
 * - **The demo:** the people are made up, so no UPI app ever opens; "Mark as paid" shows the ledger move.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Banknote, Check, Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { api } from '~/api';
import { authErrorMessage } from '~/auth/AuthProvider';
import { ME, useLedger } from '~/data/LedgerProvider';
import { Coin } from '~/glass/Coin';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

export default function Pay() {
    const { tokens } = useLook();
    const { ledger, personOf, recordPayment, real, refresh } = useLedger();
    const toast = useToast();
    const params = useLocalSearchParams<{ group: string; to: string; amount: string }>();
    const amount = Number(params.amount ?? 0);
    const person = personOf(params.to ?? '');
    const group = ledger.groups.find((candidate) => candidate.id === params.group);
    const [busy, setBusy] = useState(false);
    /** The payment your UPI app was opened for, waiting for "I've paid". */
    const [opened, setOpened] = useState<string | null>(null);
    const ready = Boolean(group) && amount > 0;

    const markPaid = (method: 'cash' | 'upi') => {
        if (!group || !ready) return;
        recordPayment({ groupId: group.id, fromId: ME, toId: person.id, amount, method });
        toast(real ? `Saved. ${person.first} confirms it next` : `Paid ${person.first} ${rupees(amount)}`);
        router.back();
    };

    const payByUpi = async () => {
        if (!group || !ready) return;
        if (!real) return toast(`${person.first} is made up, so no UPI app opens. Mark it as paid instead.`, 'info');
        if (!person.upiId) return toast(`${person.first} hasn’t added a UPI ID yet. Pay another way, then mark it paid in cash.`, 'info');
        setBusy(true);
        try {
            const { settlement } = await api.askSettlement({ groupId: group.id, toUserId: person.id, amount, method: 'upi' });
            const { upiUrl } = await api.moveSettlement(settlement.id, { action: 'open_upi' });
            setOpened(settlement.id);
            if (upiUrl) await Linking.openURL(upiUrl).catch(() => toast('No UPI app on this phone could open it. Pay another way, then tap “I’ve paid”.', 'info'));
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setBusy(false);
        }
    };

    const paidByUpi = async () => {
        if (!opened) return;
        setBusy(true);
        try {
            await api.moveSettlement(opened, { action: 'mark_paid' });
            await refresh();
            toast(`Told ${person.first}. They confirm it next`);
            router.back();
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen tabBar={false}>
            <Header title="Pay back" eyebrow={group?.name} close />
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Coin kind="coin" size={92} />
                <Text variant="caption" tone="secondary" onLiquid>
                    You pay
                </Text>
                <Text variant="hero" weight="medium" onLiquid tabular>
                    {rupees(amount)}
                </Text>
            </View>
            <GlassSurface style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                <Avatar name={person.name} size={46} />
                <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="heading" align="left">
                        {person.name}
                    </Text>
                    <Text variant="caption" tone="secondary" align="left">
                        UPI · {person.upiId ?? 'no UPI ID yet'}
                    </Text>
                </View>
            </GlassSurface>

            {opened ? (
                <GlassButton kind="accent" contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} disabled={busy} onPress={() => void paidByUpi()}>
                    <Check size={20} color={tokens.onAccent} strokeWidth={2.6} />
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Telling them…' : 'I’ve paid'}
                    </Text>
                </GlassButton>
            ) : (
                <GlassButton kind={real ? 'accent' : 'thin'} contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} disabled={busy} onPress={() => void payByUpi()}>
                    <Smartphone size={20} color={real ? tokens.onAccent : tokens.fg} />
                    <Text variant={real ? 'heading' : 'label'} tone={real ? 'onAccent' : 'primary'}>
                        {busy ? 'Opening…' : 'Pay with a UPI app'}
                    </Text>
                </GlassButton>
            )}

            {real ? (
                <GlassButton kind="thin" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} disabled={busy} onPress={() => markPaid('cash')}>
                    <Banknote size={20} color={tokens.fg} />
                    <Text variant="label">I paid in cash</Text>
                </GlassButton>
            ) : (
                <GlassButton kind="accent" contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} onPress={() => markPaid('upi')}>
                    <Check size={20} color={tokens.onAccent} strokeWidth={2.6} />
                    <Text variant="heading" tone="onAccent">
                        Mark as paid
                    </Text>
                </GlassButton>
            )}

            <Text variant="caption" tone="muted" onLiquid>
                {real ? `${person.first} confirms the payment before the balance clears. Your money never passes through SplitIT.` : `In the real app, ${person.first} confirms the payment before the balance clears.`}
            </Text>
        </Screen>
    );
}
