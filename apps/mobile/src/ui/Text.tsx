import { Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { FONT, TYPE, type Variant, type Weight } from '~/theme/type';

export type Tone = 'primary' | 'secondary' | 'tertiary' | 'muted' | 'accent' | 'onAccent' | 'in' | 'out' | 'danger';

interface Props extends TextProps {
    variant?: Variant;
    tone?: Tone;
    weight?: Weight;
    align?: TextStyle['textAlign'];
    /** For words that sit straight on the liquid: a soft shadow keeps them readable. */
    onLiquid?: boolean;
    /** Figures in columns line up. */
    tabular?: boolean;
}

export function Text({ variant = 'body', tone = 'primary', weight, align = 'center', onLiquid, tabular, style, ...rest }: Props) {
    const { tokens } = useLook();
    const type = TYPE[variant];
    const color = {
        primary: tokens.fg,
        secondary: tokens.fg2,
        tertiary: tokens.fg3,
        muted: tokens.muted,
        accent: tokens.accentText,
        onAccent: tokens.onAccent,
        in: tokens.moneyIn,
        out: tokens.moneyOut,
        danger: tokens.danger,
    }[tone];
    return (
        <NativeText
            maxFontSizeMultiplier={1.6}
            {...rest}
            style={[
                {
                    color,
                    fontFamily: FONT[weight ?? type.weight],
                    fontSize: type.fontSize,
                    lineHeight: type.lineHeight,
                    letterSpacing: type.letterSpacing,
                    textAlign: align,
                    textTransform: variant === 'eyebrow' ? 'uppercase' : undefined,
                    fontVariant: tabular ? ['tabular-nums'] : undefined,
                },
                onLiquid && tokens.mode === 'dark' ? { textShadowColor: tokens.inkShadow, textShadowRadius: 14, textShadowOffset: { width: 0, height: 2 } } : null,
                style,
            ]}
        />
    );
}
