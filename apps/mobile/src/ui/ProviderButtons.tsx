/** "Continue with Google" and "Continue with GitHub", on sign-in and sign-up alike. */
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth, authErrorMessage } from '~/auth/AuthProvider';
import { enterApp } from '~/auth/flow';
import { GitHubMark, GoogleMark } from './BrandMarks';
import { GlassButton } from './GlassButton';
import { Text } from './Text';

export function ProviderButtons({ onError }: { onError: (message: string) => void }) {
    const auth = useAuth();
    const [busy, setBusy] = useState<'google' | 'github' | null>(null);

    const go = async (provider: 'google' | 'github') => {
        setBusy(provider);
        try {
            if ((await auth.signInWithProvider(provider)) === 'done') enterApp();
        } catch (error) {
            onError(authErrorMessage(error));
        } finally {
            setBusy(null);
        }
    };

    return (
        <View style={{ gap: 12 }}>
            <GlassButton kind="reg" contentStyle={{ height: 56, flexDirection: 'row', gap: 12 }} disabled={busy !== null} onPress={() => go('google')}>
                <GoogleMark />
                <Text variant="label">{busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</Text>
            </GlassButton>
            <GlassButton kind="reg" contentStyle={{ height: 56, flexDirection: 'row', gap: 12 }} disabled={busy !== null} onPress={() => go('github')}>
                <GitHubMark />
                <Text variant="label">{busy === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}</Text>
            </GlassButton>
        </View>
    );
}
