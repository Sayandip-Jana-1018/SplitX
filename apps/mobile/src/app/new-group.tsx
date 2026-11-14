/** A new group for your real account: a name and an emoji. You're its admin; invite people from its page. */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useStep } from '~/auth/flow';
import { useLedger } from '~/data/LedgerProvider';
import { Chips, type Chip } from '~/ui/Chips';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Kind = 'trip' | 'home' | 'food' | 'party' | 'hills' | 'work' | 'other';
const KINDS: (Chip<Kind> & { emoji: string })[] = [
    { id: 'trip', label: 'Trip', emoji: '✈️' },
    { id: 'home', label: 'Home', emoji: '🏠' },
    { id: 'food', label: 'Food', emoji: '🍱' },
    { id: 'party', label: 'Party', emoji: '🎉' },
    { id: 'hills', label: 'Outdoors', emoji: '🏔️' },
    { id: 'work', label: 'Work', emoji: '💼' },
    { id: 'other', label: 'Other', emoji: '👥' },
];

export default function NewGroup() {
    const { createGroup } = useLedger();
    const toast = useToast();
    const [name, setName] = useState('');
    const [kind, setKind] = useState<Kind>('trip');
    const { busy, error, run } = useStep();
    const ready = name.trim().length > 0;

    const make = () =>
        run(async () => {
            const groupId = await createGroup(name.trim(), KINDS.find((option) => option.id === kind)!.emoji);
            toast(`${name.trim()} is ready. Invite people next`);
            router.replace(`/group/${groupId}`);
        });

    return (
        <Screen tabBar={false}>
            <Header title="New group" close />
            <View style={{ gap: 14 }}>
                <Field label="Group name, like Goa Trip" value={name} onChangeText={setName} autoCapitalize="words" maxLength={50} autoFocus returnKeyType="done" onSubmitEditing={() => ready && !busy && make()} />
                <Chips label="What it’s for" options={KINDS} value={kind} onChange={setKind} />
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={make}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Making it…' : 'Make the group'}
                    </Text>
                </GlassButton>
                <Text variant="caption" tone="muted" onLiquid>
                    You’ll be its admin. Share its invite link from the group’s page.
                </Text>
            </View>
        </Screen>
    );
}
