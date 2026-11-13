/**
 * A few choices as pills on one pane of glass; the chosen one is filled with your colour. One pane
 * for the lot, not one each, because every pane of glass is its own canvas on the GPU.
 */
import { Pressable, View } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { tap } from './GlassButton';
import { Text } from './Text';

export interface Chip<T extends string> {
    id: T;
    label: string;
    emoji?: string;
}

export function Chips<T extends string>({ options, value, onChange, label }: { options: Chip<T>[]; value: T; onChange: (next: T) => void; label: string }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="thin" radius={26} style={{ padding: 6 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
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
                            style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                height: 38,
                                paddingHorizontal: 14,
                                borderRadius: 999,
                                // The fill alone can sit close to the liquid's own colour, so the choice gets a ring too.
                                borderWidth: 1.5,
                                borderColor: selected ? tokens.accentText : 'transparent',
                                backgroundColor: selected ? tokens.accent : pressed ? tokens.chip : 'transparent',
                            })}
                        >
                            {option.emoji ? <Text style={{ fontSize: 15, lineHeight: 20 }}>{option.emoji}</Text> : null}
                            <Text variant="caption" weight="bold" tone={selected ? 'onAccent' : 'primary'}>
                                {option.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </GlassSurface>
    );
}
