/**
 * The phones signed in to your account, this one first, each with when it was last seen. Another
 * one can be signed out here (a lost or old phone): its session ends and it gets no more pushes.
 * This phone signs out from Profile.
 */
import { Smartphone } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import type { DeviceInfo } from '@/lib/contract/v1';
import { api } from '~/api';
import { authErrorMessage, useAuth } from '~/auth/AuthProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Skeleton } from '~/ui/Skeleton';
import { Text } from '~/ui/Text';
import { when } from '~/ui/time';
import { useToast } from '~/ui/Toast';

const platformName = (platform: string) => (platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : platform);

export default function Devices() {
    const { tokens } = useLook();
    const auth = useAuth();
    const toast = useToast();
    const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    const load = useCallback(async () => {
        setFailed(null);
        try {
            setDevices((await api.devices()).devices);
        } catch (error) {
            setFailed(authErrorMessage(error));
        }
    }, []);

    useEffect(() => {
        if (auth.status !== 'signed_in') return;
        let live = true;
        api.devices()
            .then(({ devices: list }) => live && setDevices(list))
            .catch((error: unknown) => live && setFailed(authErrorMessage(error)));
        return () => {
            live = false;
        };
    }, [auth.status]);

    const signOut = (device: DeviceInfo) => {
        const name = device.name || platformName(device.platform);
        Alert.alert(`Sign out ${name}?`, 'Its session ends now and it gets no more notifications. Signing in again brings it back.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign out',
                style: 'destructive',
                onPress: () => {
                    api.forgetDevice(device.id)
                        .then(() => {
                            setDevices((current) => (current ?? []).filter((other) => other.id !== device.id));
                            toast(`${name} is signed out`);
                        })
                        .catch((error: unknown) => toast(authErrorMessage(error), 'info'));
                },
            },
        ]);
    };

    if (auth.status !== 'signed_in') {
        return (
            <Screen tabBar={false}>
                <Header title="Your phones" />
                <EmptyState emoji="📱" title="Only this phone" hint="Sign in, and every phone using your account shows here." />
            </Screen>
        );
    }

    return (
        <Screen tabBar={false} onRefresh={load}>
            <Header title="Your phones" />
            {failed ? (
                <View style={{ gap: 12 }}>
                    <EmptyState emoji="📡" title="Couldn’t load your phones" hint={failed} />
                    <GlassButton kind="thin" style={{ alignSelf: 'center' }} contentStyle={{ height: 46, paddingHorizontal: 26 }} onPress={() => void load()}>
                        <Text variant="label">Try again</Text>
                    </GlassButton>
                </View>
            ) : devices === null ? (
                <View style={{ gap: 10 }}>
                    <Skeleton height={72} radius={22} />
                    <Skeleton height={72} radius={22} />
                </View>
            ) : (
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {devices.map((device, index) => (
                        <View key={device.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                <Smartphone size={19} color={tokens.fg} strokeWidth={2.2} />
                            </View>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text variant="label" align="left" numberOfLines={1}>
                                    {device.name || platformName(device.platform)}
                                    {device.current ? ' · this phone' : ''}
                                </Text>
                                <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                                    {[platformName(device.platform), device.appVersion ? `v${device.appVersion}` : null, device.signedIn ? `seen ${when(new Date(device.lastSeenAt)).toLowerCase()}` : 'signed out'].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                            {device.current ? null : (
                                <GlassButton kind="thin" contentStyle={{ height: 34, paddingHorizontal: 14 }} onPress={() => signOut(device)}>
                                    <Text variant="caption" weight="bold" tone="danger">
                                        Sign out
                                    </Text>
                                </GlassButton>
                            )}
                        </View>
                    ))}
                </GlassSurface>
            )}
        </Screen>
    );
}
