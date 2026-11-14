/**
 * Where your changes stand, shown only when there's something to say: how many are waiting to be
 * sent (and that you're offline, if you are), and each change the server refused, with why and a
 * choice: try it again, or let it go.
 */
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { View } from 'react-native';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton } from './GlassButton';
import { Text } from './Text';

export function SyncNote() {
    const { waiting, stuck, sync, real, retryStuck, discardStuck, refresh } = useLedger();
    const { tokens } = useLook();
    if (!real || (waiting === 0 && stuck.length === 0)) return null;
    const offline = sync === 'offline';

    return (
        <GlassSurface kind="thin" style={{ paddingVertical: 12, paddingHorizontal: 16, gap: 12 }}>
            {waiting > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {offline ? <CloudOff size={18} color={tokens.fg2} strokeWidth={2.2} /> : <RefreshCw size={18} color={tokens.fg2} strokeWidth={2.2} />}
                    <Text variant="caption" tone="secondary" align="left" style={{ flex: 1 }}>
                        {offline ? (waiting === 1 ? 'You’re offline. 1 change is saved here and goes when you’re back.' : `You’re offline. ${waiting} changes are saved here and go when you’re back.`) : waiting === 1 ? 'Sending 1 change…' : `Sending ${waiting} changes…`}
                    </Text>
                    {offline ? (
                        <GlassButton kind="thin" contentStyle={{ paddingHorizontal: 14, height: 34 }} onPress={() => void refresh()}>
                            <Text variant="caption" weight="bold">
                                Retry
                            </Text>
                        </GlassButton>
                    ) : null}
                </View>
            ) : null}
            {stuck.map((entry, index) => (
                <View key={entry.change.id} style={{ gap: 8, paddingTop: index === 0 && waiting === 0 ? 0 : 12, borderTopWidth: index === 0 && waiting === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                    <Text variant="label" align="left">
                        Couldn’t save {entry.label}
                    </Text>
                    <Text variant="caption" tone="secondary" align="left">
                        {entry.why}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <GlassButton kind="accent" style={{ flex: 1 }} contentStyle={{ height: 38 }} onPress={() => retryStuck(entry.change.id)}>
                            <Text variant="caption" weight="bold" tone="onAccent">
                                Try again
                            </Text>
                        </GlassButton>
                        <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 38 }} onPress={() => discardStuck(entry.change.id)}>
                            <Text variant="caption" weight="bold">
                                Let it go
                            </Text>
                        </GlassButton>
                    </View>
                </View>
            ))}
        </GlassSurface>
    );
}
