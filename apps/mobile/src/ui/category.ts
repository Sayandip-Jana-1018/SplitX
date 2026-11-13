/** Categories, as the website names them (src/lib/utils.ts), with an emoji for each. */
import { CATEGORIES } from '@/lib/utils';

export const CATEGORY_IDS = Object.keys(CATEGORIES);

export function categoryEmoji(id: string): string {
    if (id === 'settlement') return '✅';
    return CATEGORIES[id]?.emoji ?? CATEGORIES.general.emoji;
}

export function categoryLabel(id: string): string {
    return CATEGORIES[id]?.label ?? CATEGORIES.general.label;
}
