import { View } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { Text } from './Text';

/** Initials on a disc of the palette's colour, stacked when there are several. */
export function Avatar({ name, size = 34, ring }: { name: string; size?: number; ring?: boolean }) {
    const { tokens } = useLook();
    const initials = name
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tokens.accent,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: ring ? 2 : 0,
                borderColor: tokens.bg,
            }}
        >
            <Text variant="caption" weight="bold" tone="onAccent" style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
                {initials}
            </Text>
        </View>
    );
}

export function AvatarStack({ names, size = 26 }: { names: string[]; size?: number }) {
    const shown = names.slice(0, 4);
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            {shown.map((name, index) => (
                <View key={name} style={{ marginLeft: index === 0 ? 0 : -size * 0.32 }}>
                    <Avatar name={name} size={size} ring />
                </View>
            ))}
        </View>
    );
}
