/**
 * Asking for a 6-digit code by email: to sign in without a password, or because the password is
 * forgotten. The code itself is typed on the next screen.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '~/auth/AuthProvider';
import { LOOKS_LIKE_EMAIL, useStep } from '~/auth/flow';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

const WORDS = {
    sign_in: { title: 'Sign in with a code', lead: 'No password needed. We’ll email you a 6-digit code.' },
    password_reset: { title: 'Forgot password', lead: 'We’ll email you a 6-digit code, then you choose a new password.' },
} as const;

export default function EmailCode() {
    const params = useLocalSearchParams<{ purpose?: string; email?: string }>();
    const purpose = params.purpose === 'password_reset' ? 'password_reset' : 'sign_in';
    const auth = useAuth();
    const [email, setEmail] = useState(params.email ?? '');
    const { busy, error, run } = useStep();
    const ready = LOOKS_LIKE_EMAIL.test(email.trim());

    const send = () =>
        run(async () => {
            await auth.sendCode(email, purpose);
            router.push({ pathname: '/code', params: { email: email.trim(), purpose } });
        });

    return (
        <Screen tabBar={false}>
            <Header title={WORDS[purpose].title} />
            <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                {WORDS[purpose].lead}
            </Text>
            <View style={{ gap: 12 }}>
                <Field label="Your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" maxLength={254} autoFocus returnKeyType="send" onSubmitEditing={() => ready && send()} />
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={send}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Sending…' : 'Email me a code'}
                    </Text>
                </GlassButton>
            </View>
        </Screen>
    );
}
