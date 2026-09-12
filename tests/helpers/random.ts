/** Deterministic PRNG (mulberry32) so property tests reproduce exactly from a seed. */
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
