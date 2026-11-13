/** A text field on glass. Its label is spoken by screen readers and shown as a placeholder. */
import { TextInput, type TextInputProps } from 'react-native';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';

export function Field({ label, style, ...rest }: TextInputProps & { label: string }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="thin" radius={20} style={{ paddingHorizontal: 18 }}>
            <TextInput
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
