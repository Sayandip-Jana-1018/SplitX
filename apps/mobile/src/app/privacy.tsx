/**
 * Privacy and data, as on the website's settings: everything SplitIT holds about you as one file,
 * and closing your account for good. Closing is refused while you owe or are owed; once done, your
 * name, email and payment details are erased, you leave every group, and every phone is signed out.
 */
import { router } from 'expo-router';
import { Download, Smartphone, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { api } from '~/api';
import { authErrorMessage, useAuth } from '~/auth/AuthProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { EmptyState } from '~/ui/EmptyState';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

export default function Privacy() {
    const { tokens } = useLook();
    const auth = useAuth();
    const toast = useToast();
    const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
    const [confirm, setConfirm] = useState('');

    if (auth.status !== 'signed_in') {
        return (
            <Screen tabBar={false}>
                <Header title="Privacy and data" />
                <EmptyState emoji="🔒" title="Nothing kept about you" hint="The demo’s people and money are made up and stay on this phone. Sign in, and your data can be exported or deleted here." />
            </Screen>
        );
    }

    const exportIt = async () => {
        setBusy('export');
        try {
            const data = await api.exportData();
            await Share.share({ title: 'My SplitIT data', message: JSON.stringify(data, null, 2) });
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setBusy(null);
        }
    };

    const deleteIt = async () => {
        setBusy('delete');
        try {
            await auth.deleteAccount();
            toast('Your account was deleted', 'info');
            router.replace('/');
        } catch (error) {
            toast(authErrorMessage(error), 'info');
            setBusy(null);
        }
    };

    return (
        <Screen tabBar={false}>
            <Header title="Privacy and data" />

            <GlassSurface style={{ padding: 18, gap: 12, alignItems: 'center' }}>
                <Text variant="heading">Your data</Text>
                <Text variant="caption" tone="secondary" style={{ maxWidth: 300 }}>
                    Your profile, groups, expenses, payments, contacts and recent notifications, as one file to keep or send.
                </Text>
                <GlassButton kind="thin" disabled={busy !== null} style={{ alignSelf: 'stretch' }} contentStyle={{ height: 48, flexDirection: 'row', gap: 8 }} onPress={() => void exportIt()}>
                    <Download size={18} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="label">{busy === 'export' ? 'Gathering it…' : 'Export my data'}</Text>
                </GlassButton>
            </GlassSurface>

            <GlassSurface style={{ padding: 18, gap: 12, alignItems: 'center' }}>
                <Text variant="heading">Your phones</Text>
                <Text variant="caption" tone="secondary" style={{ maxWidth: 300 }}>
                    Every phone signed in to your account. Sign out one you no longer use.
                </Text>
                <GlassButton kind="thin" style={{ alignSelf: 'stretch' }} contentStyle={{ height: 48, flexDirection: 'row', gap: 8 }} onPress={() => router.push('/devices')}>
                    <Smartphone size={18} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="label">See your phones</Text>
                </GlassButton>
            </GlassSurface>

            <GlassSurface style={{ padding: 18, gap: 12, alignItems: 'center' }}>
                <Text variant="heading" tone="danger">
                    Delete account
                </Text>
                <Text variant="caption" tone="secondary" style={{ maxWidth: 320 }}>
                    This can’t be undone. Your name, email, photo and payment details are erased, you leave every group, and every phone is signed out. What you were part of stays in each group’s history as “Deleted user”, so everyone’s balances still add up, and groups you own pass to their longest-standing member. Settle up first: you can’t delete while you owe or are owed.
                </Text>
                <View style={{ alignSelf: 'stretch' }}>
                    <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
                </View>
                <GlassButton
                    kind="thin"
                    disabled={busy !== null || confirm.trim().toUpperCase() !== 'DELETE'}
                    style={{ alignSelf: 'stretch' }}
                    contentStyle={{ height: 48, flexDirection: 'row', gap: 8 }}
                    onPress={() => void deleteIt()}
                >
                    <Trash2 size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" tone="danger">
                        {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
                    </Text>
                </GlassButton>
            </GlassSurface>
        </Screen>
    );
}
