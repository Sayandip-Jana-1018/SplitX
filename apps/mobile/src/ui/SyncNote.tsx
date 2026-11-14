/**
 * Where your changes stand, shown only when there's something to say: how many are waiting to be
 * sent (and that you're offline, if you are), and each change the server refused, with why and a
 * choice: try it again, or let it go. Centred, like the rest of the app.
 */
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react-native';
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
        <GlassSurface kind="thin" style={{ paddingVertical: 16, paddingHorizontal: 18, gap: 14, alignItems: 'center' }}>
            {waiting > 0 ? (
                <View style={{ alignItems: 'center', gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {offline ? <CloudOff size={17} color={tokens.fg2} strokeWidth={2.2} /> : <RefreshCw size={17} color={tokens.fg2} strokeWidth={2.2} />}
                        <Text variant="label">{offline ? 'You’re offline' : waiting === 1 ? 'Sending 1 change…' : `Sending ${waiting} changes…`}</Text>
                    </View>
                    {offline ? (
                        <>
                            <Text variant="caption" tone="secondary" style={{ maxWidth: 280 }}>
                                {waiting === 1 ? '1 change is saved on your phone and goes when you’re back.' : `${waiting} changes are saved on your phone and go when you’re back.`}
                            </Text>
                            <GlassButton kind="thin" contentStyle={{ paddingHorizontal: 22, height: 36, flexDirection: 'row', gap: 6 }} onPress={() => void refresh()}>
                                <RefreshCw size={14} color={tokens.fg} strokeWidth={2.4} />
                                <Text variant="caption" weight="bold">
                                    Try now
                                </Text>
                            </GlassButton>
                        </>
                    ) : null}
                </View>
            ) : null}
            {stuck.map((entry, index) => (
                <View key={entry.change.id} style={{ alignSelf: 'stretch', alignItems: 'center', gap: 6, paddingTop: index === 0 && waiting === 0 ? 0 : 14, borderTopWidth: index === 0 && waiting === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TriangleAlert size={17} color={tokens.danger} strokeWidth={2.2} />
                        <Text variant="label" style={{ flexShrink: 1 }}>
                            Couldn’t save {entry.label}
                        </Text>
                    </View>
                    <Text variant="caption" tone="secondary" style={{ maxWidth: 280 }}>
                        {entry.why}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, alignSelf: 'stretch' }}>
                        <GlassButton kind="accent" style={{ flex: 1 }} contentStyle={{ height: 40 }} onPress={() => retryStuck(entry.change.id)}>
                            <Text variant="caption" weight="bold" tone="onAccent">
                                Try again
                            </Text>
                        </GlassButton>
                        <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 40 }} onPress={() => discardStuck(entry.change.id)}>
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
