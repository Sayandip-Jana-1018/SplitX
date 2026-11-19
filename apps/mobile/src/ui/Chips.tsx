/**
 * A few choices as pills on one pane of glass; the chosen one is filled with your colour. One pane
 * for the lot, not one each, because every pane of glass is its own canvas on the GPU.
 *
 * `rail`: one row that scrolls sideways, for lists that would otherwise wrap onto two or three rows
 * (categories, groups). The chosen one is scrolled into view.
 */
import { useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { tap } from './GlassButton';
import { Text } from './Text';

export interface Chip<T extends string> {
    id: T;
    label: string;
    emoji?: string;
}

export function Chips<T extends string>({ options, value, onChange, label, rail }: { options: Chip<T>[]; value: T; onChange: (next: T) => void; label: string; rail?: boolean }) {
    const { tokens } = useLook();
    const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
    const spots = useRef(new Map<string, number>());
    const pills = options.map((option) => {
                    const selected = option.id === value;
                    return (
                        <Pressable
                            key={option.id}
                            onLayout={rail ? (event) => spots.current.set(option.id, event.nativeEvent.layout.x) : undefined}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            onPress={() => {
                                tap();
                                onChange(option.id);
                                // Keeps the one just chosen in view, with a little of the one before it showing.
                                const x = spots.current.get(option.id);
                                if (rail && x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
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
                });
    if (rail) {
        return (
            <GlassSurface kind="thin" radius={26} style={{ paddingVertical: 6 }}>
                <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label} contentContainerStyle={{ gap: 6, paddingHorizontal: 6, flexGrow: 1, justifyContent: 'center' }}>
                    {pills}
                </ScrollView>
            </GlassSurface>
        );
    }
    return (
        <GlassSurface kind="thin" radius={26} style={{ padding: 6 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                {pills}
            </View>
        </GlassSurface>
    );
}
