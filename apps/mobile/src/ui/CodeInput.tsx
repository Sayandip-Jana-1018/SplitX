/**
 * Six boxes for an emailed code. One hidden field takes the typing, so pasting the whole code and
 * Android's one-time-code autofill both work; the boxes only show it. When the sixth digit lands,
 * `onComplete` runs.
 */
import { useRef, type ComponentRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import { Text } from './Text';

const LENGTH = 6;

export function CodeInput({ value, onChange, onComplete, autoFocus = true }: { value: string; onChange: (next: string) => void; onComplete?: (code: string) => void; autoFocus?: boolean }) {
    const { tokens } = useLook();
    const input = useRef<ComponentRef<typeof TextInput>>(null);
    return (
        <Pressable accessibilityLabel="Six-digit code" onPress={() => input.current?.focus()} style={{ alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                {Array.from({ length: LENGTH }, (_, index) => {
                    const digit = value[index] ?? '';
                    const current = index === Math.min(value.length, LENGTH - 1);
                    return (
                        <View
                            key={index}
                            style={{
                                width: 46,
                                height: 58,
                                borderRadius: 16,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: tokens.chip,
                                borderWidth: current ? 2 : 1,
                                borderColor: current ? tokens.accentText : tokens.border,
                            }}
                        >
                            <Text style={{ fontFamily: FONT.bold, fontSize: 26, lineHeight: 32 }}>{digit}</Text>
                        </View>
                    );
                })}
            </View>
            <TextInput
                ref={input}
                value={value}
                onChangeText={(text) => {
                    const next = text.replace(/\D/g, '').slice(0, LENGTH);
                    onChange(next);
                    if (next.length === LENGTH) onComplete?.(next);
                }}
                autoFocus={autoFocus}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={LENGTH}
                caretHidden
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent' }}
            />
        </Pressable>
    );
}
