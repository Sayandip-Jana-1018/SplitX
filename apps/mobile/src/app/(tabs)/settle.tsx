/** The fewest payments that clear every group, and one tap to pay or remind. */
import { useState } from 'react';
import { View } from 'react-native';
import { BALANCE, TRANSFERS } from '~/data/demo';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { GlassButton } from '~/ui/GlassButton';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function Settle() {
    const { tokens } = useLook();
    const [notice, setNotice] = useState<string | null>(null);
    return (
        <Screen>
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
                    <Text variant="title" tone="out" tabular>
                        {rupees(BALANCE.youOwePaise)}
                    </Text>
                </GlassSurface>
                <GlassSurface kind="accent" style={{ flex: 1, paddingVertical: 18, gap: 4 }}>
                    <Text variant="caption" tone="onAccent">
                        Owed to you
                    </Text>
                    <Text variant="title" tone="onAccent" tabular>
                        {rupees(BALANCE.owedToYouPaise)}
                    </Text>
                </GlassSurface>
            </View>
            <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                {TRANSFERS.map((transfer, index) => {
                    const youPay = transfer.from === 'You';
                    const other = youPay ? transfer.to : transfer.from;
                    return (
                        <View key={transfer.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                            <Avatar name={other} size={40} />
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text variant="label" align="left" numberOfLines={1}>
                                    {youPay ? `You pay ${other}` : `${other} pays you`}
                                </Text>
                                <Text variant="caption" tone="secondary" align="left" tabular>
                                    {transfer.group} · {rupees(transfer.paise)}
                                </Text>
                            </View>
                            <GlassButton
                                kind={youPay ? 'accent' : 'thin'}
                                contentStyle={{ paddingHorizontal: 16, height: 38 }}
                                onPress={() => setNotice(youPay ? 'Paying by UPI arrives in Phase 3.' : 'Reminders arrive in Phase 3.')}
                            >
                                <Text variant="caption" weight="bold" tone={youPay ? 'onAccent' : 'primary'}>
                                    {youPay ? 'Pay' : 'Remind'}
                                </Text>
                            </GlassButton>
                        </View>
                    );
                })}
            </GlassSurface>
            {notice ? (
                <Text variant="caption" tone="secondary" onLiquid>
                    {notice}
                </Text>
            ) : null}
        </Screen>
    );
}
