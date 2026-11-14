/** Rupees the Indian way: ₹1,23,456.78, from whole paise, as the server stores them. */
const FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function rupees(paise: number, options: { sign?: boolean } = {}): string {
    const value = FORMAT.format(Math.abs(paise) / 100);
    if (!options.sign || paise === 0) return `₹${value}`;
    return `${paise > 0 ? '+' : '−'}₹${value}`;
}

/** "1 member", "3 members". */
export const members = (count: number) => (count === 1 ? '1 member' : `${count} members`);
