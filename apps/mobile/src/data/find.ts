/**
 * Finding things in what happened: the search, sort and category filter of the Activity tab, as
 * the website's expense list has them (src/app/(app)/transactions/page.tsx). Pure, so the
 * website's test runner tests it (tests/unit/mobileFind.test.ts).
 */
import type { ActivityItem } from './ledger';

export type Order = 'recent' | 'highest';

export interface ActivityFilter {
    /** Words to find in an expense's name, its group, the people in it, or its category. */
    query: string;
    /** One category, which leaves payments out; null for everything. */
    category: string | null;
    order: Order;
}

/** Lower case, without accents, so "cafe" finds "Café". */
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The items that match every word searched for, in the order asked: newest first, or the biggest
 * amount first (newest first among equals).
 */
export function findActivity(items: ActivityItem[], filter: ActivityFilter, groupName: (id: string) => string, categoryName: (id: string) => string): ActivityItem[] {
    const words = plain(filter.query).split(/\s+/).filter(Boolean);
    const found = items.filter((item) => {
        if (filter.category && item.category !== filter.category) return false;
        if (words.length === 0) return true;
        const text = plain([item.title, groupName(item.groupId), item.kind === 'expense' ? categoryName(item.category) : '', ...item.who].join(' '));
        return words.every((word) => text.includes(word));
    });
    const newest = (a: ActivityItem, b: ActivityItem) => b.at.getTime() - a.at.getTime();
    return [...found].sort(filter.order === 'highest' ? (a, b) => b.amount - a.amount || newest(a, b) : newest);
}

/** The categories your expenses use, most used first (the first used first among equals). */
export function categoriesUsed(items: ActivityItem[]): string[] {
    const counts = new Map<string, number>();
    for (const item of [...items].reverse()) if (item.kind === 'expense') counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
}
