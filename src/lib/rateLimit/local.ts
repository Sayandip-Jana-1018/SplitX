/**
 * A fixed-window counter in this process's memory: the limiter for sign-in,
 * registration and password reset when the shared one (Redis) is missing or
 * down. Those routes are what password guessing and email bombing hit, so they
 * must not fail open. Each server counts on its own, which is weaker than the
 * shared count but far from nothing.
 *
 * Bounded: past MAX_KEYS it forgets the oldest windows first.
 */

const MAX_KEYS = 10_000;

const globalForLocal = globalThis as typeof globalThis & {
    __splitxLocalLimits?: Map<string, { windowStart: number; count: number }>;
};

function windows() {
    globalForLocal.__splitxLocalLimits ??= new Map();
    return globalForLocal.__splitxLocalLimits;
}

export function hitLocally(key: string, limit: number, windowMs: number, now = Date.now()) {
    const counters = windows();
    const windowStart = now - (now % windowMs);
    let entry = counters.get(key);
    if (!entry || entry.windowStart !== windowStart) {
        counters.delete(key);
        entry = { windowStart, count: 0 };
        counters.set(key, entry);
        while (counters.size > MAX_KEYS) {
            const oldest = counters.keys().next().value;
            if (oldest === undefined) break;
            counters.delete(oldest);
        }
    }
    const allowed = entry.count < limit;
    if (allowed) entry.count += 1;
    return { allowed, resetMs: windowStart + windowMs - now };
}

/** Test hook. */
export function clearLocalLimits() {
    windows().clear();
}
