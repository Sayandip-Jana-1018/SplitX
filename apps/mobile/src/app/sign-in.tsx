/**
 * Signing in: Google or GitHub (through the website's own sign-in page, in a secure in-app
 * browser), or an email and password, or a 6-digit code by email instead of a password. Forgot
 * the password? A code sets a new one. New here? Create an account, or just try the demo.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ApiError } from '~/api';
import { useAuth } from '~/auth/AuthProvider';
import { enterApp, LOOKS_LIKE_EMAIL, useStep } from '~/auth/flow';
import { Coin } from '~/glass/Coin';
import { useLook } from '~/theme/ThemeProvider';
import { Field, type FieldRef } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { PasswordField } from '~/ui/PasswordField';
import { ProviderButtons } from '~/ui/ProviderButtons';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function SignIn() {
    const params = useLocalSearchParams<{ email?: string }>();
    const auth = useAuth();
    const { tokens } = useLook();
    const [email, setEmail] = useState(params.email ?? '');
    const [password, setPassword] = useState('');
    const passwordField = useRef<FieldRef>(null);
    const { busy, error, setError, run } = useStep();
    const ready = LOOKS_LIKE_EMAIL.test(email.trim()) && password.length > 0;

    const withPassword = () =>
        run(async () => {
            try {
                await auth.signInWithPassword(email, password);
                enterApp();
            } catch (caught) {
                // A password account whose address isn't confirmed yet: confirm it with a code instead of a link.
                if (caught instanceof ApiError && caught.code === 'email_unverified') {
                    await auth.sendCode(email, 'confirm_sign_up');
                    router.push({ pathname: '/code', params: { email: email.trim(), purpose: 'confirm_sign_up' } });
                    return;
                }
                throw caught;
            }
        });

    const link = (label: string, onPress: () => void) => (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onPress}>
            <Text variant="label" tone="accent" onLiquid>
                {label}
            </Text>
        </Pressable>
    );

    return (
        <Screen tabBar={false}>
            <Header title="Sign in" />

            <View style={{ alignItems: 'center', gap: 8 }}>
                <Coin kind="coin" size={92} />
                <Text variant="display" onLiquid>
                    Welcome back
                </Text>
                <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 300 }}>
                    Your groups and balances, on every phone and the website.
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
                <Field label="Your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" maxLength={254} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordField.current?.focus()} />
                <PasswordField ref={passwordField} label="Password" value={password} onChangeText={setPassword} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => ready && !busy && withPassword()} />
                {error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy} onPress={withPassword}>
                    <Text variant="heading" tone="onAccent">
                        {busy ? 'Signing in…' : 'Sign in'}
                    </Text>
                </GlassButton>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 }}>
                    {link('Forgot password?', () => router.push({ pathname: '/email-code', params: { purpose: 'password_reset', email: email.trim() } }))}
                    {link('Email me a code', () => router.push({ pathname: '/email-code', params: { purpose: 'sign_in', email: email.trim() } }))}
                </View>
            </View>

            <View style={{ alignItems: 'center', gap: 14, paddingTop: 4 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Text variant="label" tone="secondary" onLiquid>
                        New to SplitIT?
                    </Text>
                    {link('Create an account', () => router.replace('/sign-up'))}
                </View>
                {link('Just looking? Try the demo', () => run(async () => {
                    await auth.startDemo();
                    enterApp();
                }))}
            </View>
        </Screen>
    );
}
