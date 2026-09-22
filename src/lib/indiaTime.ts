/**
 * Calendar days and months as SplitX's users live them: India Standard Time,
 * UTC+5:30 all year (India keeps no daylight saving time).
 *
 * Servers run in UTC (Vercel's do), so a month read off the server's clock
 * begins at 05:30 in India: an expense added at 1 a.m. on the 1st was counted
 * in the month before, and "this month" was empty for the first 5½ hours.
 */

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The same instant, moved so that its UTC fields read as India's wall clock. */
const wallClock = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS);

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-09": the month this instant falls in, in India. */
export function istMonthKey(date: Date): string {
    const wall = wallClock(date);
    return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}`;
}

/** "2026-09-22": the day this instant falls on, in India. */
export function istDateKey(date: Date): string {
    const wall = wallClock(date);
    return `${istMonthKey(date)}-${pad(wall.getUTCDate())}`;
}

/**
 * The instant a month begins in India (midnight IST on the 1st), counted from
 * the month `now` falls in: 0 is this month, -1 last month.
 */
export function istMonthStart(now: Date, monthsFromNow = 0): Date {
    const wall = wallClock(now);
    return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + monthsFromNow, 1) - IST_OFFSET_MS);
}
