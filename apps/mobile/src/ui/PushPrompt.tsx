/**
 * The one place the app offers notifications without being asked: a card on Home, for your real
 * account only, until you turn them on or put it away. The phone's own question comes only after
 * you tap Turn on.
 */
import { BellRing } from 'lucide-react-native';
import { View } from 'react-native';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { usePush } from '~/notifications/PushProvider';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton } from './GlassButton';
import { Text } from './Text';
import { useToast } from './Toast';

export function PushPrompt() {
    const { real } = useLedger();
    const push = usePush();
    const { tokens } = useLook();
    const toast = useToast();
    if (!real || push.state !== 'off' || push.promptHidden) return null;

    const turnOn = async () => {
        const now = await push.turnOn();
        if (now === 'on') toast('Notifications are on');
        else {
            push.hidePrompt();
            toast(now === 'asked-no' ? 'You can allow them later in Profile' : 'No problem. Profile has them any time', 'info');
        }
    };

    return (
        <GlassSurface kind="thin" style={{ paddingVertical: 18, paddingHorizontal: 18, gap: 10, alignItems: 'center' }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                <BellRing size={22} color={tokens.accentText} strokeWidth={2.2} />
            </View>
            <Text variant="heading">Know the moment it happens</Text>
            <Text variant="caption" tone="secondary" style={{ maxWidth: 290 }}>
                A notification when friends add an expense, pay you back, or remind you. Nothing else.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 }}>
                <GlassButton kind="accent" style={{ flex: 1 }} contentStyle={{ height: 44 }} onPress={() => void turnOn()}>
                    <Text variant="label" tone="onAccent">
                        Turn on
                    </Text>
                </GlassButton>
                <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 44 }} onPress={push.hidePrompt}>
                    <Text variant="label">Not now</Text>
                </GlassButton>
            </View>
        </GlassSurface>
    );
}
