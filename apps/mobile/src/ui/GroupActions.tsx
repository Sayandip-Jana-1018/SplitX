/** "New group" and "Join a group", side by side: only for your real account (the demo's groups are made up). */
import { router } from 'expo-router';
import { Link2, Plus } from 'lucide-react-native';
import { View } from 'react-native';
import { useLedger } from '~/data/LedgerProvider';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton } from './GlassButton';
import { Text } from './Text';

export function GroupActions() {
    const { real } = useLedger();
    const { tokens } = useLook();
    if (!real) return null;
    return (
        <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassButton kind="accent" style={{ flex: 1 }} contentStyle={{ height: 50, flexDirection: 'row', gap: 8 }} onPress={() => router.push('/new-group')}>
                <Plus size={18} color={tokens.onAccent} strokeWidth={2.6} />
                <Text variant="label" tone="onAccent">
                    New group
                </Text>
            </GlassButton>
            <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 50, flexDirection: 'row', gap: 8 }} onPress={() => router.push('/join')}>
                <Link2 size={18} color={tokens.fg} strokeWidth={2.4} />
                <Text variant="label">Join a group</Text>
            </GlassButton>
        </View>
    );
}
