/**
 * What every panel on /ops is built from: one reading of one real source,
 * saying where it came from and when. A source that can't be read is reported
 * as unavailable, with the reason; nothing on the page is ever filled in.
 */
export type Reading<T> =
    | { ok: true; source: string; fetchedAt: string; data: T }
    | { ok: false; source: string; fetchedAt: string; error: string };

function reason(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'it did not answer in time';
        return error.message;
    }
    return 'it could not be read';
}

/** Reads one source now, and says what happened. */
export async function readSource<T>(source: string, read: () => Promise<T>): Promise<Reading<T>> {
    const fetchedAt = new Date().toISOString();
    try {
        return { ok: true, source, fetchedAt, data: await read() };
    } catch (error) {
        return { ok: false, source, fetchedAt, error: reason(error) };
    }
}

const recent = new Map<string, { until: number; reading: Promise<Reading<unknown>> }>();

/**
 * A reading at most `ttlMs` old: however many dashboards are open, a source is
 * read once per interval per server process (GitHub allows 5,000 reads an hour
 * per token). Concurrent callers share one read in flight.
 */
export function recentReading<T>(key: string, ttlMs: number, read: () => Promise<Reading<T>>): Promise<Reading<T>> {
    const now = Date.now();
    const hit = recent.get(key);
    if (hit && hit.until > now) return hit.reading as Promise<Reading<T>>;
    const reading = read();
    recent.set(key, { until: now + ttlMs, reading });
    return reading;
}

/** Test hook: forget every cached reading. */
export function forgetReadings() {
    recent.clear();
}
