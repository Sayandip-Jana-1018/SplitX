/**
 * Plus Jakarta Sans, as on the web. A custom font needs one family per weight on Android,
 * so a weight is named by its family rather than by fontWeight.
 */
import {
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

export const FONT_FILES = {
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
};

export const FONT = {
    regular: 'PlusJakartaSans_400Regular',
    medium: 'PlusJakartaSans_500Medium',
    semibold: 'PlusJakartaSans_600SemiBold',
    bold: 'PlusJakartaSans_700Bold',
    heavy: 'PlusJakartaSans_800ExtraBold',
} as const;

export type Weight = keyof typeof FONT;

/** One scale for the whole app: sizes, line heights and tracking that read well on a phone. */
export const TYPE = {
    hero: { fontSize: 44, lineHeight: 48, letterSpacing: -1.6, weight: 'heavy' },
    display: { fontSize: 34, lineHeight: 38, letterSpacing: -1.1, weight: 'heavy' },
    title: { fontSize: 26, lineHeight: 31, letterSpacing: -0.6, weight: 'bold' },
    heading: { fontSize: 19, lineHeight: 24, letterSpacing: -0.3, weight: 'bold' },
    body: { fontSize: 16, lineHeight: 22, letterSpacing: 0, weight: 'medium' },
    label: { fontSize: 14, lineHeight: 18, letterSpacing: 0, weight: 'semibold' },
    // No letter spacing: on Android a little of it made words like "Yesterday" measure a hair short and drop off the line.
    caption: { fontSize: 12.5, lineHeight: 16, letterSpacing: 0, weight: 'medium' },
    eyebrow: { fontSize: 11.5, lineHeight: 14, letterSpacing: 1.2, weight: 'bold' },
} as const;

export type Variant = keyof typeof TYPE;
