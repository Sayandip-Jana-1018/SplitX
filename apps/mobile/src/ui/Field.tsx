/**
 * A text field on glass. Its label is spoken by screen readers and shown as a placeholder.
 * `ref` reaches the input, so a form can move to its next field when "Next" is pressed.
 */
import type { ComponentRef, Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';

export type FieldRef = ComponentRef<typeof TextInput>;

export function Field({ label, style, ref, ...rest }: TextInputProps & { label: string; ref?: Ref<FieldRef> }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="thin" radius={20} style={{ paddingHorizontal: 18 }}>
            <TextInput
                ref={ref}
                accessibilityLabel={label}
                placeholder={label}
                placeholderTextColor={tokens.muted}
                maxLength={80}
                {...rest}
                style={[{ height: 54, color: tokens.fg, fontFamily: FONT.semibold, fontSize: 16, textAlign: 'center' }, style]}
            />
        </GlassSurface>
    );
}
