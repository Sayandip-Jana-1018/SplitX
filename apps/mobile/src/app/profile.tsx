/** You: your name and UPI ID, how the app looks, starting the preview over, and the way out. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Bell, ChevronRight, CircleHelp, LogOut, Palette, RotateCcw, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ME, personById } from '~/data/ledger';
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
    /** Where it goes; without one, it arrives in a later phase. */
    href?: '/appearance';
    soon?: string;
    /** Asks first, in a sheet. */
    reset?: boolean;
}

const ROWS: Row[] = [
    { icon: Palette, label: 'Appearance', href: '/appearance' },
    { icon: Bell, label: 'Notifications', soon: 'Reminders and payment alerts arrive in Phase 4' },
    { icon: ShieldCheck, label: 'Privacy and data', soon: 'Export and delete your data arrive in Phase 3' },
    { icon: CircleHelp, label: 'Help', soon: 'Help arrives before the store release' },
    { icon: RotateCcw, label: 'Start the preview over', reset: true },
];

/** "0.1.0 · build 12" in an installed app; just the version in Expo Go, which has no build of its own. */
const config = Constants.expoConfig;
const VERSION = [config?.version, config?.android?.versionCode ? `build ${config.android.versionCode}` : null].filter(Boolean).join(' · ');

export default function Profile() {
    const { tokens } = useLook();
    const { ledger, resetLedger } = useLedger();
    const toast = useToast();
    const [asking, setAsking] = useState(false);
    const me = personById(ME);
    const paid = ledger.expenses.filter((expense) => expense.payerId === ME).reduce((sum, expense) => sum + expense.amount, 0);

    const signOut = () => {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
    };

    return (
        <>
            <Screen tabBar={false}>
                <Header title="Profile" />

                <View style={{ alignItems: 'center', gap: 10 }}>
                    <Avatar name={me.name} size={88} ring />
                    <View style={{ alignItems: 'center', gap: 2 }}>
                        <Text variant="title" onLiquid>
                            {me.name}
                        </Text>
                        <Text variant="label" tone="secondary" onLiquid>
                            UPI · {me.upiId}
                        </Text>
                    </View>
                    <GlassSurface kind="thin" radius={999} style={{ paddingVertical: 6, paddingHorizontal: 14 }}>
                        <Text variant="caption" weight="bold" tone="accent">
                            Preview account
                        </Text>
                    </GlassSurface>
                </View>

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

                <GlassSurface style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
                    {ROWS.map((row, index) => {
                        const Icon = row.icon;
                        return (
                            <Pressable
                                key={row.label}
                                accessibilityRole="button"
                                accessibilityHint={row.soon}
                                onPress={() => {
                                    tap();
                                    if (row.href) router.push(row.href);
                                    else if (row.reset) setAsking(true);
                                    else if (row.soon) toast(row.soon, 'info');
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

                <GlassButton kind="thin" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={signOut}>
                    <LogOut size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Sign out
                    </Text>
                </GlassButton>

                <Text variant="caption" tone="muted" onLiquid>
                    SplitIT preview {VERSION} · the people and money in it are made up
                </Text>
            </Screen>

            <Sheet open={asking} onClose={() => setAsking(false)} title="Start the preview over?" hint="Everything you added goes, and the made-up groups, expenses and chats come back as they were.">
                <GlassButton
                    kind="reg"
                    contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }}
                    onPress={() => {
                        setAsking(false);
                        resetLedger();
                        toast('The preview starts over');
                    }}
                >
                    <RotateCcw size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Start over
                    </Text>
                </GlassButton>
                <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => setAsking(false)}>
                    <Text variant="heading" tone="onAccent">
                        Keep my changes
                    </Text>
                </GlassButton>
            </Sheet>
        </>
    );
}
