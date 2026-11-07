/** Light or dark, one of 16 colours, a kind of glass, and how much moves: the website's choices. */
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { GLASS_THEMES, PALETTE_NAMES, type PaletteId } from '@shared/glass/palette';
import { GLASS_LABELS, GLASS_STYLE_IDS } from '@shared/glass/styles';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook, type ModePreference, type MotionPreference } from '~/theme/ThemeProvider';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

const MODES: { id: ModePreference; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
];

const MOTIONS: { id: MotionPreference; label: string }[] = [
    { id: 'full', label: 'Full' },
    { id: 'calm', label: 'Calm' },
];

function Choice<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (next: T) => void }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="thin" radius={999} style={{ flexDirection: 'row', padding: 5 }}>
            {options.map((option) => {
                const selected = option.id === value;
                return (
                    <Pressable
                        key={option.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => {
                            tap();
                            onChange(option.id);
                        }}
                        style={{ flex: 1, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? tokens.accent : 'transparent' }}
                    >
                        <Text variant="label" tone={selected ? 'onAccent' : 'primary'}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </GlassSurface>
    );
}

export default function Appearance() {
    const look = useLook();
    const { tokens } = look;
    const palettes = Object.keys(GLASS_THEMES) as PaletteId[];
    return (
        <Screen tabBar={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title" onLiquid>
                    Appearance
                </Text>
                <View style={{ position: 'absolute', right: 0 }}>
                    <GlassButton kind="thin" contentStyle={{ width: 42, height: 42 }} accessibilityLabel="Close" onPress={() => router.back()}>
                        <X size={20} color={tokens.fg} />
                    </GlassButton>
                </View>
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Mode
                </Text>
                <Choice options={MODES} value={look.preference} onChange={look.setPreference} />
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Colour
                </Text>
                <GlassSurface style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 6, rowGap: 14 }}>
                    {palettes.map((id) => {
                        const selected = id === look.paletteId;
                        return (
                            <Pressable
                                key={id}
                                accessibilityRole="radio"
                                accessibilityLabel={PALETTE_NAMES[id]}
                                accessibilityState={{ selected }}
                                onPress={() => {
                                    tap();
                                    look.setPalette(id);
                                }}
                                style={{ width: '25%', alignItems: 'center', gap: 6 }}
                            >
                                <View
                                    style={{
                                        width: 46,
                                        height: 46,
                                        borderRadius: 23,
                                        backgroundColor: tokens.swatch(id),
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderWidth: selected ? 3 : 1,
                                        borderColor: selected ? tokens.fg : tokens.border,
                                    }}
                                >
                                    {selected ? <Check size={20} color="#ffffff" strokeWidth={3} /> : null}
                                </View>
                                <Text variant="caption" weight={selected ? 'bold' : 'medium'} tone={selected ? 'primary' : 'secondary'}>
                                    {PALETTE_NAMES[id]}
                                </Text>
                            </Pressable>
                        );
                    })}
                </GlassSurface>
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Glass
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                    {GLASS_STYLE_IDS.map((id) => {
                        const selected = id === look.glassStyle;
                        return (
                            <Pressable
                                key={id}
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}
                                onPress={() => {
                                    tap();
                                    look.setGlassStyle(id);
                                }}
                                style={{ width: '47%' }}
                            >
                                <GlassSurface glassStyle={id} radius={22} style={{ paddingVertical: 18, paddingHorizontal: 10, gap: 4, borderWidth: selected ? 2 : 0, borderColor: tokens.accentText }}>
                                    <Text variant="heading">{GLASS_LABELS[id].name}</Text>
                                    <Text variant="caption" tone="secondary">
                                        {GLASS_LABELS[id].hint}
                                    </Text>
                                </GlassSurface>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Motion
                </Text>
                <Choice options={MOTIONS} value={look.motion} onChange={look.setMotion} />
                <Text variant="caption" tone="secondary" onLiquid>
                    Calm stills the liquid and the coins. It's always on when your phone asks for reduced motion.
                </Text>
            </View>
        </Screen>
    );
}
