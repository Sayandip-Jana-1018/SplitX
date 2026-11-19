/**
 * The top of the main screens, balanced either side of the wordmark: you and search on the left,
 * notifications (with how many are unread) and the look of the app on the right.
 */
import { router } from 'expo-router';
import { Bell, Palette, Search } from 'lucide-react-native';
import { Image, View } from 'react-native';
import { useAuth, useYou } from '~/auth/AuthProvider';
import { useUnread } from '~/notifications/inbox';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from './Avatar';
import { GlassButton } from './GlassButton';
import { Text } from './Text';

export function Wordmark({ size = 'label' }: { size?: 'label' | 'heading' }) {
    const logo = size === 'heading' ? 34 : 28;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={require('../../assets/icon.png')} style={{ width: logo, height: logo, borderRadius: logo / 2 }} />
            <Text variant={size === 'heading' ? 'title' : 'heading'} weight="heavy">
                Split
                <Text variant={size === 'heading' ? 'title' : 'heading'} weight="heavy" tone="accent">
                    IT
                </Text>
            </Text>
        </View>
    );
}

/** The way to Appearance (colour, mode, glass, motion), on every screen: a colour can be changed anywhere. */
export function ThemeButton({ size = 46 }: { size?: number }) {
    const { tokens } = useLook();
    return (
        <GlassButton kind="thin" contentStyle={{ width: size, height: size }} accessibilityLabel="Appearance: colour, mode and glass" onPress={() => router.push('/appearance')}>
            <Palette size={20} color={tokens.fg} strokeWidth={2} />
        </GlassButton>
    );
}

const SIDE = 42;

export function TopBar() {
    const you = useYou();
    const { tokens } = useLook();
    const signedIn = useAuth().status === 'signed_in';
    const unread = useUnread(signedIn);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <GlassButton kind="clear" contentStyle={{ width: SIDE, height: SIDE }} accessibilityLabel="Your profile" onPress={() => router.push('/profile')}>
                    <Avatar name={you.name} size={32} />
                </GlassButton>
                <GlassButton kind="thin" contentStyle={{ width: SIDE, height: SIDE }} accessibilityLabel="Search" onPress={() => router.push('/search')}>
                    <Search size={19} color={tokens.fg} strokeWidth={2.2} />
                </GlassButton>
            </View>
            <Wordmark />
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <GlassButton kind="thin" contentStyle={{ width: SIDE, height: SIDE }} accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} onPress={() => router.push('/notifications')}>
                    <Bell size={19} color={tokens.fg} strokeWidth={2.2} />
                    {unread > 0 ? (
                        <View style={{ position: 'absolute', top: 5, right: 4, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: tokens.accent, alignItems: 'center', justifyContent: 'center' }}>
                            <Text tone="onAccent" weight="bold" style={{ fontSize: 10, lineHeight: 13 }}>
                                {unread > 9 ? '9+' : unread}
                            </Text>
                        </View>
                    ) : null}
                </GlassButton>
                <ThemeButton size={SIDE} />
            </View>
        </View>
    );
}
