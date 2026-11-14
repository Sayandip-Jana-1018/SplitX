/** Joining a group with the invite link someone sent you, or just its code. */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useStep } from '~/auth/flow';
import { useLedger } from '~/data/LedgerProvider';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

export default function Join() {
    const { joinGroup, ledger } = useLedger();
    const toast = useToast();
    const [link, setLink] = useState('');
    const { busy, error, run } = useStep();
    const ready = link.trim().length >= 8;

    const join = () =>
        run(async () => {
            const groupId = await joinGroup(link);
            const name = ledger.groups.find((group) => group.id === groupId)?.name;
            toast(name ? `You’re in ${name}` : 'You’re in');
            router.replace(`/group/${groupId}`);
        });

    return (
        <Screen tabBar={false}>
            <Header title="Join a group" close />
            <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                Paste the invite link someone in the group sent you. Links work for 7 days.
            </Text>
            <View style={{ gap: 14 }}>
                <Field label="Invite link or code" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} autoFocus returnKeyType="go" onSubmitEditing={() => ready && !busy && join()} />
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={join}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Joining…' : 'Join'}
                    </Text>
                </GlassButton>
            </View>
        </Screen>
    );
}
