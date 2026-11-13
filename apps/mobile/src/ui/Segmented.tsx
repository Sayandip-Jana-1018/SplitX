/** One choice from a few, on a pill of glass; the chosen one is filled with your colour. */
import { Pressable } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { tap } from './GlassButton';
import { Text } from './Text';

export interface Option<T extends string> {
    id: T;
    label: string;
}

export function Segmented<T extends string>({ options, value, onChange, compact }: { options: Option<T>[]; value: T; onChange: (next: T) => void; compact?: boolean }) {
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
                        style={{ flex: 1, height: compact ? 36 : 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: selected ? tokens.accentText : 'transparent', backgroundColor: selected ? tokens.accent : 'transparent' }}
                    >
                        <Text variant={compact ? 'caption' : 'label'} weight="bold" tone={selected ? 'onAccent' : 'primary'}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </GlassSurface>
    );
}
