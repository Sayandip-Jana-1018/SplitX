/**
 * Your name and UPI ID: asked once for an account made with an email code (it has no name yet),
 * and from Profile to change them. The UPI ID is what friends pay you back with.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '~/auth/AuthProvider';
import { enterApp, useStep } from '~/auth/flow';
import { Field, type FieldRef } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

const UPI = /^[\w.-]+@[\w]+$/;

export default function YourName() {
    const params = useLocalSearchParams<{ edit?: string }>();
    const editing = params.edit === '1';
    const auth = useAuth();
    const toast = useToast();
    const [name, setName] = useState(auth.me?.name ?? '');
    const [upiId, setUpiId] = useState(auth.me?.upiId ?? '');
    const upiField = useRef<FieldRef>(null);
    const { busy, error, run } = useStep();
    const upiOk = upiId.trim() === '' || UPI.test(upiId.trim());
    const ready = name.trim().length > 0 && upiOk;

    const save = () =>
        run(async () => {
            await auth.saveProfile({ name: name.trim(), upiId: upiId.trim() });
            if (editing) {
                toast('Saved');
                router.back();
            } else enterApp();
        });

    return (
        <Screen tabBar={false}>
            <Header title={editing ? 'Name and UPI ID' : 'Welcome to SplitIT'} />
            {editing ? null : (
                <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                    What should your friends see? Add your UPI ID too, so they can pay you back in one tap.
                </Text>
            )}
            <View style={{ gap: 12 }}>
                <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words" maxLength={60} autoFocus={!editing} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => upiField.current?.focus()} />
                <Field ref={upiField} label="UPI ID (optional), like name@okbank" value={upiId} onChangeText={setUpiId} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={100} returnKeyType="done" onSubmitEditing={() => ready && !busy && save()} />
                {!upiOk ? (
                    <Text variant="caption" tone="danger" onLiquid>
                        A UPI ID looks like name@bank.
                    </Text>
                ) : null}
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={save}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Saving…' : editing ? 'Save' : 'Continue'}
                    </Text>
                </GlassButton>
            </View>
        </Screen>
    );
}
