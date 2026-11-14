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

/**
 * One scale for the whole app: sizes, line heights and tracking that read well on a phone.
 * Every line height is at least 1.26 times its size, Plus Jakarta Sans's own line (ascent 1.038 em,
 * descent 0.222 em): Android centres the letters in a shorter line and cuts the tails of g, y and p.
 */
export const TYPE = {
    hero: { fontSize: 44, lineHeight: 56, letterSpacing: -1.6, weight: 'heavy' },
    display: { fontSize: 34, lineHeight: 43, letterSpacing: -1.1, weight: 'heavy' },
    title: { fontSize: 26, lineHeight: 33, letterSpacing: -0.6, weight: 'bold' },
    heading: { fontSize: 19, lineHeight: 24, letterSpacing: -0.3, weight: 'bold' },
    body: { fontSize: 16, lineHeight: 22, letterSpacing: 0, weight: 'medium' },
    label: { fontSize: 14, lineHeight: 18, letterSpacing: 0, weight: 'semibold' },
    caption: { fontSize: 12.5, lineHeight: 16, letterSpacing: 0, weight: 'medium' },
    eyebrow: { fontSize: 11.5, lineHeight: 15, letterSpacing: 1.2, weight: 'bold' },
} as const;

export type Variant = keyof typeof TYPE;

// On Android a short right-aligned label shrunk to its own width can lose its last word ("You get back"
// drew as "You get"). Give such a label its column's width: `style={{ alignSelf: 'stretch' }}` with
// numberOfLines={1}, as ActivityList and the Groups tab do.
