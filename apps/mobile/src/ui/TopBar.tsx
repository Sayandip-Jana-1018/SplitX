/** The top of the main screens: you, the wordmark, and the look of the app. */
import { router } from 'expo-router';
import { Palette } from 'lucide-react-native';
import { Image, View } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { ME } from '~/data/demo';
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

export function TopBar() {
    const { tokens } = useLook();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <GlassButton kind="clear" contentStyle={{ width: 46, height: 46 }} accessibilityLabel="Your profile" onPress={() => router.push('/appearance')}>
                <Avatar name={ME.name} size={34} />
            </GlassButton>
            <Wordmark />
            <GlassButton kind="thin" contentStyle={{ width: 46, height: 46 }} accessibilityLabel="Appearance" onPress={() => router.push('/appearance')}>
                <Palette size={20} color={tokens.fg} strokeWidth={2} />
            </GlassButton>
        </View>
    );
}
