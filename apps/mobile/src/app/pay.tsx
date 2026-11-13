/**
 * Paying someone back. The real app hands the payment to your UPI app; in this preview the people
 * are made up, so no UPI app is ever opened, and "Mark as paid" records it to show the ledger move.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Smartphone } from 'lucide-react-native';
import { View } from 'react-native';
import { personById } from '~/data/ledger';
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
    const { ledger, recordPayment } = useLedger();
    const toast = useToast();
    const params = useLocalSearchParams<{ group: string; to: string; amount: string }>();
    const amount = Number(params.amount ?? 0);
    const person = personById(params.to ?? '');
    const group = ledger.groups.find((candidate) => candidate.id === params.group);

    const markPaid = () => {
        if (!group || !(amount > 0)) return;
        recordPayment({ groupId: group.id, fromId: ME, toId: person.id, amount, method: 'upi' });
        toast(`Paid ${person.first} ${rupees(amount)}`);
        router.back();
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
            <GlassButton kind="thin" contentStyle={{ height: 56, flexDirection: 'row', gap: 10 }} onPress={() => toast('Your UPI app opens here in Phase 3. These people are made up.', 'info')}>
                <Smartphone size={20} color={tokens.fg} />
                <Text variant="label">Pay with a UPI app</Text>
            </GlassButton>
            <GlassButton kind="accent" contentStyle={{ height: 58, flexDirection: 'row', gap: 10 }} onPress={markPaid}>
                <Check size={20} color={tokens.onAccent} strokeWidth={2.6} />
                <Text variant="heading" tone="onAccent">
                    Mark as paid
                </Text>
            </GlassButton>
            <Text variant="caption" tone="muted" onLiquid>
                In the real app, {person.first} confirms the payment before the balance clears.
            </Text>
        </Screen>
    );
}
