/**
 * Lightweight, on-device category inference from free text
 * (expense titles, merchant names, payment notifications).
 * Shared by the expense composer and future auto-capture flows.
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
    food: [
        'food', 'lunch', 'dinner', 'breakfast', 'brunch', 'pizza', 'burger', 'biryani', 'cafe', 'coffee',
        'tea', 'chai', 'restaurant', 'swiggy', 'zomato', 'dominos', 'kfc', 'mcdonald', 'starbucks',
        'snacks', 'drinks', 'bar', 'beer', 'dessert', 'icecream', 'ice cream', 'bakery', 'dhaba',
    ],
    groceries: [
        'grocery', 'groceries', 'blinkit', 'zepto', 'bigbasket', 'instamart', 'dmart', 'vegetables',
        'fruits', 'milk', 'supermarket', 'kirana',
    ],
    transport: [
        'uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'rickshaw', 'metro', 'bus', 'train', 'irctc',
        'flight', 'indigo', 'airline', 'toll', 'parking', 'bike rental',
    ],
    fuel: ['fuel', 'petrol', 'diesel', 'cng', 'hpcl', 'bpcl', 'indian oil', 'shell'],
    stay: ['hotel', 'airbnb', 'hostel', 'oyo', 'resort', 'homestay', 'stay', 'rent', 'room'],
    shopping: ['shopping', 'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'clothes', 'mall', 'meesho'],
    tickets: ['ticket', 'tickets', 'movie', 'cinema', 'pvr', 'inox', 'entry', 'concert', 'event', 'bookmyshow', 'museum'],
    entertainment: ['game', 'games', 'netflix', 'spotify', 'prime', 'party', 'club', 'bowling', 'arcade', 'karaoke'],
    bills: ['bill', 'electricity', 'wifi', 'internet', 'broadband', 'recharge', 'water', 'gas cylinder', 'dth', 'maintenance'],
    medical: ['medicine', 'medicines', 'pharmacy', 'doctor', 'hospital', 'medical', 'apollo', 'clinic', 'pharmeasy', '1mg'],
};

/** Returns a category key (e.g. "food") when the text clearly matches, otherwise null. */
export function inferCategory(text: string | null | undefined): string | null {
    const normalized = ` ${(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
    if (normalized.trim().length < 3) return null;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const keyword of keywords) {
            if (normalized.includes(` ${keyword} `) || normalized.includes(` ${keyword}s `)) {
                return category;
            }
        }
    }
    return null;
}
