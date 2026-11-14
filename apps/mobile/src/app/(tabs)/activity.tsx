/** Every expense and payment, newest first. */
import { useMemo } from 'react';
import { View } from 'react-native';
import { activity } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { ActivityList } from '~/ui/ActivityList';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function Activity() {
    const { ledger, onRefresh } = useLedger();
    const items = useMemo(() => activity(ledger), [ledger]);
    return (
        <Screen onRefresh={onRefresh}>
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Every rupee, accounted for
                </Text>
                <Text variant="display" onLiquid>
                    Activity
                </Text>
            </View>
            <ActivityList items={items} />
        </Screen>
    );
}
