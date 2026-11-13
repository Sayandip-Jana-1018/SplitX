/**
 * Signing in, as it will look: Google, GitHub, or a link by email. The accounts connect in
 * Phase 3; until then every way in opens the preview with its made-up people, and nothing typed
 * here leaves the phone.
 */
import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Coin } from '~/glass/Coin';
import { useLook } from '~/theme/ThemeProvider';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A letter on a disc, standing in for a provider's mark until real sign-in arrives. */
function Badge({ letter }: { letter: string }) {
    const { tokens } = useLook();
    return (
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="label" weight="heavy">
                {letter}
            </Text>
        </View>
    );
}

export default function SignIn() {
    const { tokens } = useLook();
    const toast = useToast();
    const [email, setEmail] = useState('');

    const enter = () => {
        toast('Preview: signed in with a made-up account', 'info');
        if (router.canDismiss()) router.dismissAll();
        router.replace('/home');
    };

    return (
        <Screen tabBar={false}>
            <Header title="Sign in" />

            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Coin kind="coin" size={104} />
                <Text variant="display" onLiquid>
                    Welcome back
                </Text>
                <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 300 }}>
                    Your groups and balances follow you to every phone and the website.
                </Text>
            </View>

            <View style={{ gap: 12 }}>
                <GlassButton kind="reg" contentStyle={{ height: 56, flexDirection: 'row', gap: 12 }} onPress={enter}>
                    <Badge letter="G" />
                    <Text variant="label">Continue with Google</Text>
                </GlassButton>
                <GlassButton kind="reg" contentStyle={{ height: 56, flexDirection: 'row', gap: 12 }} onPress={enter}>
                    <Badge letter="Gh" />
                    <Text variant="label">Continue with GitHub</Text>
                </GlassButton>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
                <Text variant="caption" tone="muted" onLiquid>
                    or
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: tokens.border }} />
            </View>

            <View style={{ gap: 12 }}>
                <Field label="Your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="go" maxLength={254} />
                <GlassButton kind="accent" contentStyle={{ height: 56, flexDirection: 'row', gap: 10 }} disabled={!EMAIL.test(email.trim())} onPress={enter}>
                    <Mail size={19} color={tokens.onAccent} strokeWidth={2.4} />
                    <Text variant="heading" tone="onAccent">
                        Email me a sign-in link
                    </Text>
                </GlassButton>
            </View>

            <Text variant="caption" tone="muted" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                Real accounts connect in Phase 3. Until then, every way in opens the preview, and nothing you type here leaves your phone.
            </Text>
        </Screen>
    );
}
