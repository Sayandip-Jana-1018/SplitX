/**
 * A few choices as pills of glass; the chosen one is filled with your colour and ringed. Every
 * chip in the app looks the same; only how they sit differs:
 *
 * - by default they wrap, centred, for short lists (a group, who paid);
 * - `rail`: one row that scrolls sideways, edge to edge across the screen as Home's groups do, for
 *   lists that would otherwise wrap onto several rows (categories, groups). A chip goes off the
 *   screen's edge, never cut short inside a pill, and the chosen one is scrolled into view.
 *
 * Each pill is a pane in its screen's glass layer, all drawn in one canvas.
 */
import { useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { GlassScrollView } from '~/glass/GlassScroll';
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
            <GlassSurface
                key={option.id}
                kind={selected ? 'accent' : 'thin'}
                radius={999}
                onLayout={rail ? (event) => spots.current.set(option.id, event.nativeEvent.layout.x) : undefined}
                // The fill alone can sit close to the liquid's own colour (gold glass over gold liquid),
                // so the choice gets a ring in the words' colour, as the chosen swatch in Appearance does.
                style={{ borderWidth: selected ? 1.5 : 0, borderColor: tokens.fg }}
            >
                <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                        tap();
                        onChange(option.id);
                        // Keeps the one just chosen in view, with a little of the one before it showing.
                        const x = spots.current.get(option.id);
                        if (rail && x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16 }}
                >
                    {option.emoji ? <Text style={{ fontSize: 15, lineHeight: 20 }}>{option.emoji}</Text> : null}
                    <Text variant="caption" weight="bold" tone={selected ? 'onAccent' : 'primary'}>
                        {option.label}
                    </Text>
                </Pressable>
            </GlassSurface>
        );
    });

    if (rail) {
        return (
            <GlassScrollView
                ref={scroller}
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="radiogroup"
                accessibilityLabel={label}
                style={{ marginHorizontal: -20 }}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 4, flexGrow: 1, justifyContent: 'center' }}
            >
                {pills}
            </GlassScrollView>
        );
    }
    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
            {pills}
        </View>
    );
}
