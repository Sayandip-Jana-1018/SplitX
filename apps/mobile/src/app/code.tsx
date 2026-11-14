/**
 * Typing the 6-digit code from the email. To sign in or confirm a new account it goes as soon as
 * the sixth digit lands; to reset a password it goes with the new password. A new code can be
 * asked for after 30 seconds.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '~/auth/AuthProvider';
import { enterApp, useStep } from '~/auth/flow';
import { CodeInput } from '~/ui/CodeInput';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { PasswordField } from '~/ui/PasswordField';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Purpose = 'sign_in' | 'confirm_sign_up' | 'password_reset';
const RESEND_AFTER_S = 30;

export default function Code() {
    const params = useLocalSearchParams<{ email?: string; purpose?: string }>();
    const email = params.email ?? '';
    const purpose: Purpose = params.purpose === 'password_reset' || params.purpose === 'confirm_sign_up' ? params.purpose : 'sign_in';
    const resetting = purpose === 'password_reset';
    const auth = useAuth();
    const toast = useToast();
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [wait, setWait] = useState(RESEND_AFTER_S);
    const { busy, error, run } = useStep();

    useEffect(() => {
        if (wait <= 0) return;
        const timer = setTimeout(() => setWait((left) => left - 1), 1000);
        return () => clearTimeout(timer);
    }, [wait]);

    const submit = (typed = code) =>
        run(async () => {
            if (resetting) {
                await auth.resetPassword(email, typed, password);
                toast('Your new password is set');
                enterApp();
                return;
            }
            const { isNew } = await auth.verifyCode(email, typed, purpose === 'confirm_sign_up' ? 'confirm_sign_up' : 'sign_in');
            if (isNew) {
                if (router.canDismiss()) router.dismissAll();
                router.replace('/your-name');
            } else enterApp();
        });

    const resend = () =>
        run(async () => {
            await auth.sendCode(email, purpose);
            setCode('');
            setWait(RESEND_AFTER_S);
            toast('A new code is on its way', 'info');
        });

    return (
        <Screen tabBar={false}>
            <Header title="Check your email" />
            <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                We sent a 6-digit code to {email}. It works for 10 minutes.
            </Text>

            <CodeInput value={code} onChange={setCode} onComplete={(typed) => !resetting && !busy && submit(typed)} />

            {resetting ? (
                <PasswordField label="New password (8 or more characters)" value={password} onChangeText={setPassword} autoComplete="new-password" textContentType="newPassword" />
            ) : null}

            {error ? (
                <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                    {error}
                </Text>
            ) : null}

            <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={code.length !== 6 || busy || (resetting && password.length < 8)} onPress={() => submit()}>
                <Text variant="heading" tone="onAccent">
                    {busy ? 'Checking…' : resetting ? 'Set new password' : 'Continue'}
                </Text>
            </GlassButton>

            <View style={{ alignItems: 'center' }}>
                {wait > 0 ? (
                    <Text variant="label" tone="muted" onLiquid tabular>
                        Send a new code in {wait} s
                    </Text>
                ) : (
                    <Pressable accessibilityRole="button" hitSlop={8} disabled={busy} onPress={resend}>
                        <Text variant="label" tone="accent" onLiquid>
                            Send a new code
                        </Text>
                    </Pressable>
                )}
            </View>
            <Text variant="caption" tone="muted" onLiquid style={{ maxWidth: 300, alignSelf: 'center' }}>
                Not there? Check spam, or that the address is right.
            </Text>
        </Screen>
    );
}
