/** A number pad on one slab of glass, for amounts: one dot, two decimals, no leading zeros. */
import { Delete } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { tap } from './GlassButton';
import { Text } from './Text';

const ROWS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', 'back'],
] as const;

type Key = (typeof ROWS)[number][number];

/** What the amount becomes after one key. */
export function press(current: string, key: Key): string {
    if (key === 'back') return current.slice(0, -1);
    if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
    const [, decimals] = current.split('.');
    if (decimals !== undefined && decimals.length >= 2) return current;
    if (current === '0') return key;
    if (current.replace('.', '').length >= 9) return current;
    return current + key;
}

export function Keypad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="reg" radius={28} style={{ padding: 6, gap: 4 }}>
            {ROWS.map((row) => (
                <View key={row.join('')} style={{ flexDirection: 'row', gap: 4 }}>
                    {row.map((key) => (
                        <Pressable
                            key={key}
                            accessibilityRole="keyboardkey"
                            accessibilityLabel={key === 'back' ? 'Delete' : key === '.' ? 'Decimal point' : key}
                            onPress={() => {
                                tap();
                                onChange(press(value, key));
                            }}
                            onLongPress={key === 'back' ? () => onChange('') : undefined}
                            style={({ pressed }) => ({ flex: 1, height: 56, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? tokens.chip : 'transparent' })}
                        >
                            {key === 'back' ? (
                                <Delete size={24} color={tokens.fg} strokeWidth={2} />
                            ) : (
                                <Text variant="title" weight="semibold">
                                    {key}
                                </Text>
                            )}
                        </Pressable>
                    ))}
                </View>
            ))}
        </GlassSurface>
    );
}
