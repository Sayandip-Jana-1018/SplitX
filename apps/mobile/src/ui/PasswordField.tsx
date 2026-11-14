/** A password on glass, with an eye to show or hide it. */
import { Eye, EyeOff } from 'lucide-react-native';
import { useState, type Ref } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import type { FieldRef } from './Field';
import { tap } from './GlassButton';

export function PasswordField({ label, ref, ...rest }: TextInputProps & { label: string; ref?: Ref<FieldRef> }) {
    const { tokens } = useLook();
    const [shown, setShown] = useState(false);
    return (
        <GlassSurface kind="thin" radius={20} style={{ paddingLeft: 52, paddingRight: 8, flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
                ref={ref}
                accessibilityLabel={label}
                placeholder={label}
                placeholderTextColor={tokens.muted}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={200}
                {...rest}
                style={{ flex: 1, height: 54, color: tokens.fg, fontFamily: FONT.semibold, fontSize: 16, textAlign: 'center' }}
            />
            <View style={{ width: 44, alignItems: 'center' }}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={shown ? 'Hide password' : 'Show password'}
                    hitSlop={10}
                    onPress={() => {
                        tap();
                        setShown((now) => !now);
                    }}
                >
                    {shown ? <EyeOff size={20} color={tokens.muted} /> : <Eye size={20} color={tokens.muted} />}
                </Pressable>
            </View>
        </GlassSurface>
    );
}
