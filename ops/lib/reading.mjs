/**
 * What every panel on /ops is built from, as the app's src/lib/ops/reading.ts
 * defines it: one reading of one real source, saying where it came from and
 * when. A source that can't be read is reported as unavailable, with the
 * reason; nothing is ever filled in.
 *
 * @template T
 * @typedef {{ ok: true, source: string, fetchedAt: string, data: T } | { ok: false, source: string, fetchedAt: string, error: string }} Reading
 */

function reason(error) {
    if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'it did not answer in time';
        return error.message;
    }
    return 'it could not be read';
}

/**
 * Reads one source now, and says what happened.
 * @template T
 * @param {string} source
 * @param {() => Promise<T>} read
 * @returns {Promise<Reading<T>>}
 */
export async function readSource(source, read) {
    const fetchedAt = new Date().toISOString();
    try {
        return { ok: true, source, fetchedAt, data: await read() };
    } catch (error) {
        return { ok: false, source, fetchedAt, error: reason(error) };
    }
}

const recent = new Map();

/**
 * A value at most `ttlMs` old; concurrent callers share one read in flight.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export function cached(key, ttlMs, read) {
    const now = Date.now();
    const hit = recent.get(key);
    if (hit && hit.until > now) return hit.value;
    const value = read();
    recent.set(key, { until: now + ttlMs, value });
    return value;
}

/** Test hook. */
export function forget() {
    recent.clear();
}
