/**
 * You. Signed in: your name, email and UPI ID, how the app looks, and signing out, here or on
 * every device. Trying the demo: the made-up account, starting the demo over, and leaving it.
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Bell, ChevronRight, CircleHelp, LogOut, Palette, PenLine, RotateCcw, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAuth, useYou } from '~/auth/AuthProvider';
import { useStep } from '~/auth/flow';
import { ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Sheet } from '~/ui/Sheet';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

interface Row {
    icon: LucideIcon;
    label: string;
    onPress: () => void;
    soon?: boolean;
}

type Asking = 'sign_out' | 'everywhere' | 'restart' | null;

/** "0.1.0 · build 12" in an installed app; just the version in Expo Go, which has no build of its own. */
const config = Constants.expoConfig;
const VERSION = [config?.version, config?.android?.versionCode ? `build ${config.android.versionCode}` : null].filter(Boolean).join(' · ');

/** Back to Welcome, with nothing to go back to. */
function toWelcome() {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
}

export default function Profile() {
    const { tokens } = useLook();
    const auth = useAuth();
    const you = useYou();
    const { ledger, resetLedger } = useLedger();
    const toast = useToast();
    const [asking, setAsking] = useState<Asking>(null);
    const { busy, run } = useStep();
    const signedIn = auth.status === 'signed_in';
    const paid = ledger.expenses.filter((expense) => expense.payerId === ME).reduce((sum, expense) => sum + expense.amount, 0);

    const soon = (message: string) => () => toast(message, 'info');
    const rows: Row[] = [
        ...(signedIn ? [{ icon: PenLine, label: 'Name and UPI ID', onPress: () => router.push({ pathname: '/your-name', params: { edit: '1' } }) }] : []),
        { icon: Palette, label: 'Appearance', onPress: () => router.push('/appearance') },
        { icon: Bell, label: 'Notifications', onPress: soon('Reminders and payment alerts arrive in Phase 3'), soon: true },
        { icon: ShieldCheck, label: 'Privacy and data', onPress: soon('Export and delete your data arrive with your real groups'), soon: true },
        { icon: CircleHelp, label: 'Help', onPress: soon('Help arrives before the store release'), soon: true },
        ...(signedIn ? [] : [{ icon: RotateCcw, label: 'Start the demo over', onPress: () => setAsking('restart') }]),
    ];

    const confirm = (step: () => Promise<void>) =>
        run(async () => {
            setAsking(null);
            await step();
        });

    return (
        <>
            <Screen tabBar={false}>
                <Header title="Profile" />

                <View style={{ alignItems: 'center', gap: 10 }}>
                    <Avatar name={you.name} size={88} ring />
                    <View style={{ alignItems: 'center', gap: 2 }}>
                        <Text variant="title" onLiquid>
                            {you.name}
                        </Text>
                        {signedIn && auth.me?.email ? (
                            <Text variant="label" tone="secondary" onLiquid>
                                {auth.me.email}
                            </Text>
                        ) : null}
                        <Text variant="label" tone="secondary" onLiquid>
                            {signedIn ? (auth.me?.upiId ? `UPI · ${auth.me.upiId}` : 'No UPI ID yet') : 'UPI · asha@demo'}
                        </Text>
                    </View>
                    <GlassSurface kind="thin" radius={999} style={{ paddingVertical: 6, paddingHorizontal: 14 }}>
                        <Text variant="caption" weight="bold" tone="accent">
                            {signedIn ? 'Signed in' : 'Demo · made-up people and money'}
                        </Text>
                    </GlassSurface>
                </View>

                {signedIn ? (
                    <Text variant="caption" tone="muted" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                        Your real groups and balances move into the app in the next update; until then it shows the made-up ones.
                    </Text>
                ) : (
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <GlassSurface style={{ flex: 1, paddingVertical: 16, gap: 2 }}>
                            <Text variant="title" tabular>
                                {ledger.groups.length}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                groups
                            </Text>
                        </GlassSurface>
                        <GlassSurface style={{ flex: 1.6, paddingVertical: 16, gap: 2 }}>
                            <Text variant="title" tabular numberOfLines={1} adjustsFontSizeToFit>
                                {rupees(paid)}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                you paid for others
                            </Text>
                        </GlassSurface>
                    </View>
                )}

                <GlassSurface style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
                    {rows.map((row, index) => {
                        const Icon = row.icon;
                        return (
                            <Pressable
                                key={row.label}
                                accessibilityRole="button"
                                onPress={() => {
                                    tap();
                                    row.onPress();
                                }}
                                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: pressed ? tokens.chip : 'transparent', borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border })}
                            >
                                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon size={18} color={tokens.accentText} strokeWidth={2.2} />
                                </View>
                                <Text variant="label" align="left" style={{ flex: 1 }}>
                                    {row.label}
                                </Text>
                                {row.soon ? (
                                    <Text variant="caption" tone="muted">
                                        Soon
                                    </Text>
                                ) : null}
                                <ChevronRight size={18} color={tokens.muted} />
                            </Pressable>
                        );
                    })}
                </GlassSurface>

                {signedIn ? (
                    <View style={{ gap: 12 }}>
                        <GlassButton kind="thin" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} disabled={busy} onPress={() => setAsking('sign_out')}>
                            <LogOut size={18} color={tokens.danger} strokeWidth={2.2} />
                            <Text variant="label" weight="bold" tone="danger">
                                Sign out
                            </Text>
                        </GlassButton>
                        <Pressable accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center' }} onPress={() => setAsking('everywhere')}>
                            <Text variant="label" tone="secondary" onLiquid>
                                Sign out of all devices
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => run(async () => {
                        await auth.leaveDemo();
                        toWelcome();
                    })}>
                        <Text variant="heading" tone="onAccent">
                            Leave the demo and sign in
                        </Text>
                    </GlassButton>
                )}

                <Text variant="caption" tone="muted" onLiquid>
                    SplitIT {VERSION}
                </Text>
            </Screen>

            <Sheet open={asking === 'sign_out'} onClose={() => setAsking(null)} title="Sign out?" hint="You can sign back in any time with your email, Google or GitHub.">
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => confirm(async () => {
                    await auth.signOut();
                    toWelcome();
                })}>
                    <LogOut size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Sign out
                    </Text>
                </GlassButton>
                <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => setAsking(null)}>
                    <Text variant="heading" tone="onAccent">
                        Stay signed in
                    </Text>
                </GlassButton>
            </Sheet>

            <Sheet open={asking === 'everywhere'} onClose={() => setAsking(null)} title="Sign out of all devices?" hint="Every phone and browser signed in to your account is signed out, this one included. Do this if a device was lost or someone else knows your password.">
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => confirm(async () => {
                    await auth.signOutEverywhere();
                    toast('Signed out of every device');
                    toWelcome();
                })}>
                    <LogOut size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Sign out everywhere
                    </Text>
                </GlassButton>
                <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => setAsking(null)}>
                    <Text variant="heading" tone="onAccent">
                        Keep them signed in
                    </Text>
                </GlassButton>
            </Sheet>

            <Sheet open={asking === 'restart'} onClose={() => setAsking(null)} title="Start the demo over?" hint="Everything you added goes, and the made-up groups, expenses and chats come back as they were.">
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => confirm(async () => {
                    resetLedger();
                    toast('The demo starts over');
                })}>
                    <RotateCcw size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Start over
                    </Text>
                </GlassButton>
                <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => setAsking(null)}>
                    <Text variant="heading" tone="onAccent">
                        Keep my changes
                    </Text>
                </GlassButton>
            </Sheet>
        </>
    );
}
