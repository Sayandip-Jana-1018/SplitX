/**
 * The floating tab bar: one pill of glass, four places, and adding an expense in its centre,
 * where the thumb rests.
 */
import { router } from 'expo-router';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import { Plus, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Text } from '~/ui/Text';

export function GlassTabBar({ children }: ViewProps & { children?: ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 12) + 4, alignItems: 'center' }}>
            <GlassSurface kind="thick" radius={999} style={{ width: '92%', maxWidth: 440, flexDirection: 'row', alignItems: 'center', padding: 6 }}>
                {children}
            </GlassSurface>
        </View>
    );
}

interface TabButtonProps extends TabTriggerSlotProps {
    icon: LucideIcon;
    label: string;
}

// The trigger's ref is for its own default button; this one doesn't need it.
export function TabButton({ icon: Icon, label, isFocused, onPress, ref: _ref, ...rest }: TabButtonProps) {
    const { tokens } = useLook();
    const color = isFocused ? tokens.fg : tokens.muted;
    return (
        <Pressable
            {...rest}
            onPress={(event) => {
                tap();
                onPress?.(event);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            style={{ flex: 1, minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: isFocused ? tokens.chip : 'transparent' }}
        >
            <Icon size={21} color={color} strokeWidth={isFocused ? 2.4 : 2} />
            <Text variant="caption" weight={isFocused ? 'bold' : 'semibold'} style={{ color, fontSize: 11 }}>
                {label}
            </Text>
        </Pressable>
    );
}

export function AddButton() {
    const { tokens } = useLook();
    return (
        <View style={{ flex: 1, alignItems: 'center' }}>
            <GlassButton kind="accent" contentStyle={{ width: 56, height: 56 }} accessibilityLabel="Add an expense" onPress={() => router.push('/add')}>
                <Plus size={26} color={tokens.onAccent} strokeWidth={2.4} />
            </GlassButton>
        </View>
    );
}
