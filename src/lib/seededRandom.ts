/**
 * Deterministic pseudo-random numbers (mulberry32). The same seed always gives
 * the same sequence, so simulated data and property tests reproduce exactly.
 * Not for anything security-sensitive.
 */
export function createRandom(seed: number) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
        pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    };
}

export type SeededRandom = ReturnType<typeof createRandom>;
