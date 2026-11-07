/**
 * How the money in the background moves. The engine draws it; this is only arithmetic, so
 * it can be tested without a GPU. A coin turns right round and lingers when it faces you, a
 * note or a bill rocks like paper, and the coin that splits leans back to show its thickness.
 * The phone app reads this file as well; 'worklet' lets it run there on the UI thread.
 */

export type CoinKind = 'coin' | 'rim' | 'split' | 'note' | 'bill';

const KINDS: Record<CoinKind, { code: number; reach: number }> = {
    coin: { code: 0, reach: 1.1 },
    rim: { code: 1, reach: 1.1 },
    split: { code: 2, reach: 1.5 },
    note: { code: 3, reach: 1.2 },
    bill: { code: 4, reach: 1.85 },
};

/** How long one split takes, whole to whole. */
const SPLIT_CYCLE_S = 22;
/** How far a slice travels, in radii of the coin. */
const SPLIT_FAR = 0.17;
/** How far the slices twist as they part, like an iris opening. */
const SPLIT_TWIST = 0.6;
/** One turn of the big coin behind the balance. */
const SPIN_PERIOD_S = 11;

export interface CoinPose {
    /** The direction in the screen's plane that it leans along, as a unit vector. */
    axisX: number;
    axisY: number;
    /** The sine of the lean, signed for the side that faces you. */
    lean: number;
    /** The cosine of the lean, so how much of its face you see. Never negative. */
    facing: number;
    /** The turn in its own plane, which keeps the engraving the right way up. */
    spin: number;
    /** How far the slices have parted, in radii. */
    cut: number;
    /** Where the cuts run, as a turn. */
    cutAt: number;
}

export function coinKind(raw: string | null): CoinKind {
    return raw !== null && Object.hasOwn(KINDS, raw) ? (raw as CoinKind) : 'coin';
}

/** The number the shader knows this kind by. */
export function coinCode(kind: CoinKind): number {
    return KINDS[kind].code;
}

/** How far it can reach from its centre, in radii, not counting its shadow. */
export function coinReach(kind: CoinKind): number {
    return KINDS[kind].reach;
}

function ease(x: number): number {
    'worklet';
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

/** Whole for a while, a slow parting, a while apart, and a slow return: 0 to 1. */
function splitOpen(t: number): number {
    'worklet';
    const at = (((t % SPLIT_CYCLE_S) + SPLIT_CYCLE_S) % SPLIT_CYCLE_S) / SPLIT_CYCLE_S;
    return ease((at - 0.2) / 0.2) * (1 - ease((at - 0.68) / 0.22));
}

export function splitAmount(t: number): number {
    'worklet';
    return SPLIT_FAR * splitOpen(t) * (1 + 0.06 * Math.sin(t * 0.7));
}

function posed(axis: number, turn: number, spin: number, cut = 0, cutAt = 0): CoinPose {
    'worklet';
    const sine = Math.sin(turn);
    const cosine = Math.cos(turn);
    return {
        axisX: Math.cos(axis),
        axisY: Math.sin(axis),
        lean: cosine >= 0 ? sine : -sine,
        facing: Math.abs(cosine),
        spin,
        cut,
        cutAt,
    };
}

/** `seed` keeps two pieces out of step, and `t` is in seconds. */
export function coinPose(kind: CoinKind, seed: number, t: number): CoinPose {
    'worklet';
    if (kind === 'coin') {
        const angle = t * (0.34 + (seed % 5) * 0.035) + seed * 1.9;
        const turn = angle - 0.36 * Math.sin(2 * angle);
        const axis = 0.4 * Math.sin(seed * 1.7 + t * 0.06);
        return posed(axis, turn, axis + 0.18 * Math.sin(seed + t * 0.11));
    }
    if (kind === 'note' || kind === 'bill') {
        const speed = kind === 'note' ? 0.29 : 0.23;
        const turn = 0.82 * Math.sin(t * speed + seed * 1.3);
        const axis = seed * 2.2 + 0.3 * Math.sin(t * 0.09);
        const roll = (seed % 2 === 0 ? -0.3 : 0.26) + 0.12 * Math.sin(t * 0.1 + seed);
        return posed(axis, turn, axis + roll);
    }
    if (kind === 'rim') {
        const angle = (t / SPIN_PERIOD_S) * 2 * Math.PI + seed;
        const axis = 0.1 * Math.sin(t * 0.13 + seed);
        return posed(axis, angle - 0.3 * Math.sin(2 * angle), axis);
    }
    const leanX = 0.12 * Math.sin(t * 0.21 + seed);
    const leanY = -0.3 + 0.07 * Math.sin(t * 0.17 + seed * 2.1 + 1);
    const axis = Math.atan2(leanY, leanX);
    return posed(axis, Math.hypot(leanX, leanY), axis, splitAmount(t), t * 0.02 + SPLIT_TWIST * splitOpen(t));
}
