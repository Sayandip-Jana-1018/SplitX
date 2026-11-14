/** The top of the main screens: you, the wordmark, and the look of the app. */
import { router } from 'expo-router';
import { Palette } from 'lucide-react-native';
import { Image, View } from 'react-native';
import { useYou } from '~/auth/AuthProvider';
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

export function TopBar() {
    const you = useYou();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <GlassButton kind="clear" contentStyle={{ width: 46, height: 46 }} accessibilityLabel="Your profile" onPress={() => router.push('/profile')}>
                <Avatar name={you.name} size={34} />
            </GlassButton>
            <Wordmark />
            <ThemeButton />
        </View>
    );
}
