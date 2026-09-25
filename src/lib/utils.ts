/**
 * SplitX — Utility Functions
 */

/** Format paise to rupee string: 45000 → "₹450.00" */
export function formatCurrency(paise: number, currency = 'INR'): string {
    const amount = paise / 100;
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount);
}

/** Format paise to short form: 150000 → "₹1,500" */
export function formatCurrencyShort(paise: number): string {
    const amount = paise / 100;
    if (amount >= 100000) {
        return `₹${(amount / 100000).toFixed(1)}L`;
    }
    if (amount >= 1000) {
        return `₹${(amount / 1000).toFixed(1)}K`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
}

/** Convert rupee amount (user input) to paise for storage */
export function toPaise(rupees: number): number {
    return Math.round(rupees * 100);
}

/** Convert paise to rupees for display */
export function toRupees(paise: number): number {
    return paise / 100;
}

/** Relative time: "2 hours ago", "just now", etc. */
export function timeAgo(date: Date | string): string {
    const now = new Date();
    const past = new Date(date);
    const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return past.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: past.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
}

/** Format a date nicely: "16 Feb 2026" */
export function formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** Get initials from name: "Sayan Das" → "SD" */
export function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
    return (first + last).toUpperCase();
}

/** Stable hue (0-359) derived from a name — used for avatar fallbacks */
export function getAvatarHue(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

/** Generate a stable pastel color for avatars */
export function getAvatarColor(name: string): string {
    return `hsl(${getAvatarHue(name)}, 70%, 60%)`;
}

/** Time-of-day greeting for an hour (0-23) */
export function getGreeting(hour: number): { text: string; emoji: string } {
    if (hour < 5) return { text: 'Good night', emoji: '🌙' };
    if (hour < 12) return { text: 'Good morning', emoji: '☀️' };
    if (hour < 17) return { text: 'Good afternoon', emoji: '🌤️' };
    if (hour < 21) return { text: 'Good evening', emoji: '🌆' };
    return { text: 'Good night', emoji: '🌙' };
}

/** cn — merge class names, filtering falsy values */
export function cn(...classes: (string | undefined | null | false)[]): string {
    return classes.filter(Boolean).join(' ');
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timer: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/** Category labels and emojis */
export const CATEGORIES: Record<string, { label: string; emoji: string }> = {
    general: { label: 'General', emoji: '🏷️' },
    food: { label: 'Food & Drinks', emoji: '🍕' },
    groceries: { label: 'Groceries', emoji: '🛒' },
    transport: { label: 'Transport', emoji: '🚗' },
    fuel: { label: 'Fuel', emoji: '⛽' },
    stay: { label: 'Stay', emoji: '🏨' },
    shopping: { label: 'Shopping', emoji: '🛍️' },
    tickets: { label: 'Tickets & Entry', emoji: '🎫' },
    entertainment: { label: 'Entertainment', emoji: '🎮' },
    bills: { label: 'Bills', emoji: '🧾' },
    medical: { label: 'Medical', emoji: '🏥' },
    other: { label: 'Other', emoji: '✏️' },
};

/** Get Category Data (supports custom categories) */
export function getCategoryData(category: string): { label: string; emoji: string } {
    if (!category) return CATEGORIES.general;
    if (CATEGORIES[category]) return CATEGORIES[category];
    // Custom category
    return { label: category, emoji: '🔖' };
}

/** Payment method labels and icons */
export const PAYMENT_METHODS: Record<string, { label: string; emoji: string }> = {
    cash: { label: 'Cash', emoji: '💵' },
    gpay: { label: 'Google Pay', emoji: '🔵' },
    phonepe: { label: 'PhonePe', emoji: '🟣' },
    paytm: { label: 'Paytm', emoji: '🔷' },
    upi_other: { label: 'Other UPI', emoji: '📲' },
    card: { label: 'Card', emoji: '💳' },
};
