import { describe, expect, it } from 'vitest';
import { categoriesUsed, findActivity } from '../../apps/mobile/src/data/find';
import { activity, seedLedger, type ActivityItem } from '../../apps/mobile/src/data/ledger';

const at = (day: number) => new Date(Date.UTC(2026, 10, day, 12));
const item = (over: Partial<ActivityItem> & Pick<ActivityItem, 'id' | 'title'>): ActivityItem => ({ kind: 'expense', groupId: 'goa', note: '', category: 'food', yours: 0, amount: 100, who: ['You'], at: at(1), ...over });

const items = [
    item({ id: 'a', title: 'Beach shack dinner', category: 'food', amount: 4800, who: ['You', 'Ravi', 'Meera'], at: at(5) }),
    item({ id: 'b', title: 'Scooter rental', category: 'transport', amount: 2400, who: ['Kabir', 'You'], at: at(4) }),
    item({ id: 'c', title: 'Rent, November', groupId: 'flat', category: 'bills', amount: 45000, who: ['You', 'Nisha'], at: at(3) }),
    item({ id: 'd', title: 'Café Mondegar', category: 'food', amount: 900, who: ['Ravi', 'You'], at: at(2) }),
    item({ id: 'e', kind: 'settlement', title: 'Ravi paid you back', category: 'settlement', amount: 2000, who: ['Ravi', 'You'], at: at(6) }),
];
const groups: Record<string, string> = { goa: 'Goa Trip', flat: 'Flat 402' };
const find = (filter: Partial<Parameters<typeof findActivity>[1]>) => findActivity(items, { query: '', category: null, order: 'recent', ...filter }, (id) => groups[id], (id) => ({ food: 'Food & drinks', transport: 'Transport', bills: 'Bills' })[id] ?? id).map((found) => found.id);

describe('finding things in Activity', () => {
    it('shows everything, newest first, with nothing asked', () => {
        expect(find({})).toEqual(['e', 'a', 'b', 'c', 'd']);
    });

    it('finds by name, group, person and category, every word, whatever the case or accents', () => {
        expect(find({ query: 'scooter' })).toEqual(['b']);
        expect(find({ query: 'flat' })).toEqual(['c']);
        expect(find({ query: 'kabir' })).toEqual(['b']);
        expect(find({ query: 'ravi food' })).toEqual(['a', 'd']);
        expect(find({ query: 'cafe' })).toEqual(['d']);
        expect(find({ query: '  GOA   dinner ' })).toEqual(['a']);
        expect(find({ query: 'nobody' })).toEqual([]);
    });

    it('keeps one category, leaving payments out', () => {
        expect(find({ category: 'food' })).toEqual(['a', 'd']);
    });

    it('puts the biggest first when asked, newest first among equals', () => {
        expect(find({ order: 'highest' })).toEqual(['c', 'a', 'b', 'e', 'd']);
        expect(findActivity([item({ id: 'x', title: 'x', amount: 5, at: at(1) }), item({ id: 'y', title: 'y', amount: 5, at: at(2) })], { query: '', category: null, order: 'highest' }, () => '', (id) => id).map((found) => found.id)).toEqual(['y', 'x']);
    });

    it('lists the categories used, most used first', () => {
        expect(categoriesUsed(items)).toEqual(['food', 'bills', 'transport']);
    });

    it('works on the demo’s real activity: each item knows its amount and its people', () => {
        const all = activity(seedLedger());
        expect(all.every((entry) => entry.amount > 0 && entry.who.length > 0)).toBe(true);
        expect(all.find((entry) => entry.title === 'Villa, two nights')?.who).toContain('Ravi');
    });

    it('counts and filters a category the app doesn’t know as General, so General shows once', () => {
        const odd = [...items, item({ id: 'f', title: 'Misc thing', category: 'misc', amount: 50, at: at(1) }), item({ id: 'g', title: 'Plain', category: 'general', amount: 70, at: at(1) })];
        const canonical = (id: string) => (['food', 'transport', 'bills', 'general'].includes(id) ? id : 'general');
        expect(categoriesUsed(odd, canonical)).toEqual(['general', 'food', 'bills', 'transport']);
        expect(findActivity(odd, { query: '', category: 'general', order: 'recent' }, () => '', (id) => id, canonical).map((found) => found.id).sort((a, b) => a.localeCompare(b))).toEqual(['f', 'g']);
    });
});
