/**
 * Creating an account: a name, an email and a password, confirmed with a 6-digit code by email.
 * Or Google or GitHub, which need no password at all.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '~/auth/AuthProvider';
import { enterApp, LOOKS_LIKE_EMAIL, useStep } from '~/auth/flow';
import { useLook } from '~/theme/ThemeProvider';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { PasswordField } from '~/ui/PasswordField';
import { ProviderButtons } from '~/ui/ProviderButtons';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function SignUp() {
    const auth = useAuth();
    const { tokens } = useLook();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const { busy, error, setError, run } = useStep();
    const ready = name.trim().length >= 2 && LOOKS_LIKE_EMAIL.test(email.trim()) && password.length >= 8;

    const create = () =>
        run(async () => {
            const { codeSent } = await auth.signUp(name, email, password);
            if (codeSent) router.push({ pathname: '/code', params: { email: email.trim(), purpose: 'confirm_sign_up' } });
            else enterApp();
        });

    return (
        <Screen tabBar={false}>
            <Header title="Create account" />

            <View style={{ alignItems: 'center', gap: 6 }}>
                <Text variant="display" onLiquid>
                    Join SplitIT
                </Text>
                <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 300 }}>
                    Split trips, flats and dinners with the people you share them with.
                </Text>
            </View>

            <ProviderButtons onError={setError} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
                <Text variant="caption" tone="muted" onLiquid>
                    or with your email
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
            </View>

            <View style={{ gap: 12 }}>
                <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words" maxLength={60} />
                <Field label="Your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" maxLength={254} />
                <PasswordField label="Choose a password" value={password} onChangeText={setPassword} autoComplete="new-password" textContentType="newPassword" />
                <Text variant="caption" tone="muted" onLiquid>
                    At least 8 characters. We’ll email you a code to confirm it’s you.
                </Text>
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={create}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Creating…' : 'Create account'}
                    </Text>
                </GlassButton>
            </View>

            <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
                <Text variant="label" tone="secondary" onLiquid>
                    Already have an account?
                </Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.replace('/sign-in')}>
                    <Text variant="label" tone="accent" onLiquid>
                        Sign in
                    </Text>
                </Pressable>
            </View>
        </Screen>
    );
}
