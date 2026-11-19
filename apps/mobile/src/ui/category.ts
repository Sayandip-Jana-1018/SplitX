/** Categories, as the website names them (src/lib/utils.ts), with an emoji for each. */
import { CATEGORIES } from '@/lib/utils';

export const CATEGORY_IDS = Object.keys(CATEGORIES);

export function categoryEmoji(id: string): string {
    if (id === 'settlement') return '✅';
    return CATEGORIES[id]?.emoji ?? CATEGORIES.general.emoji;
}

/** The category as one the app knows: an unknown id is General, as it is shown. */
export const knownCategory = (id: string) => (CATEGORIES[id] ? id : 'general');

export function categoryLabel(id: string): string {
    return CATEGORIES[id]?.label ?? CATEGORIES.general.label;
}
