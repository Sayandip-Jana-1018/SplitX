import { describe, expect, it } from 'vitest';
import { coinCode, coinKind, coinPose, coinReach, splitAmount, type CoinKind } from '@/lib/glass/coins';

const kinds: CoinKind[] = ['coin', 'rim', 'split', 'note', 'bill'];
const moments = Array.from({ length: 400 }, (_, index) => index * 0.37);

describe('the kinds of money in the background', () => {
    it('reads a kind from the page, and takes anything else for a coin', () => {
        expect(coinKind('note')).toBe('note');
        expect(coinKind('split')).toBe('split');
        expect(coinKind(null)).toBe('coin');
        expect(coinKind('petal')).toBe('coin');
        expect(coinKind('constructor')).toBe('coin');
    });

    it('gives each kind its own number for the shader', () => {
        expect(new Set(kinds.map(coinCode)).size).toBe(kinds.length);
    });

    it('leaves room for a slice at its furthest and for the tall bill', () => {
        expect(coinReach('split')).toBeGreaterThan(1 + Math.max(...moments.map(splitAmount)) * 1.3);
        expect(coinReach('bill')).toBeGreaterThan(1.46);
        expect(coinReach('coin')).toBeGreaterThan(1);
    });
});

describe('how a piece turns', () => {
    it.each(kinds)('%s is always a true rotation, facing you', (kind) => {
        for (const t of moments) {
            const pose = coinPose(kind, 3, t);
            expect(Math.hypot(pose.axisX, pose.axisY)).toBeCloseTo(1, 6);
            expect(Math.hypot(pose.lean, pose.facing)).toBeCloseTo(1, 6);
            expect(pose.facing).toBeGreaterThanOrEqual(0);
        }
    });

    it('never jumps as a coin goes edge-on, where the side facing you changes', () => {
        const step = 0.01;
        for (let t = 0; t < 60; t += step) {
            const now = coinPose('coin', 2, t);
            const next = coinPose('coin', 2, t + step);
            expect(Math.abs(next.facing - now.facing)).toBeLessThan(0.05);
            // The lean changes sign edge-on, where it is largest, and that is the only leap.
            if (now.facing > 0.1 && next.facing > 0.1) expect(Math.abs(next.lean - now.lean)).toBeLessThan(0.05);
        }
    });

    it('lingers when a coin faces you', () => {
        const samples = Array.from({ length: 20000 }, (_, index) => coinPose('coin', 1, index * 0.01).facing);
        const faceOn = samples.filter((facing) => facing > 0.7).length;
        expect(faceOn / samples.length).toBeGreaterThan(0.6);
    });

    it('shows you a coin edge-on at some point, but never a note or a bill', () => {
        expect(moments.some((t) => coinPose('coin', 1, t).facing < 0.2)).toBe(true);
        for (const kind of ['note', 'bill'] as const) {
            expect(Math.min(...moments.map((t) => coinPose(kind, 1, t).facing))).toBeGreaterThan(0.6);
        }
    });

    it('turns the balance coin right round, again and again', () => {
        const period = 11;
        const facing = (t: number) => coinPose('rim', 0, t).facing;
        const samples = Array.from({ length: 2200 }, (_, index) => index * 0.01);
        expect(samples.some((t) => facing(t) < 0.05)).toBe(true);
        expect(samples.some((t) => facing(t) > 0.99)).toBe(true);
        for (const t of [0, 1, 2.5, 7]) expect(facing(t + period)).toBeCloseTo(facing(t), 1);
    });

    it('leans the coin that splits back, so you see its thickness, but never far', () => {
        const facings = moments.map((t) => coinPose('split', 0, t).facing);
        expect(Math.min(...facings)).toBeGreaterThan(0.9);
        expect(Math.max(...facings)).toBeLessThan(0.995);
    });

    it('keeps two pieces out of step', () => {
        expect(coinPose('coin', 1, 5).lean).not.toBeCloseTo(coinPose('coin', 2, 5).lean, 3);
    });

    it('only cuts the coin that splits', () => {
        for (const kind of ['coin', 'rim', 'note', 'bill'] as const) {
            expect(moments.every((t) => coinPose(kind, 0, t).cut === 0)).toBe(true);
        }
        expect(moments.some((t) => coinPose('split', 0, t).cut > 0)).toBe(true);
    });
});

describe('the split', () => {
    const cycle = 22;

    it('starts whole and comes back whole', () => {
        expect(splitAmount(0)).toBe(0);
        expect(splitAmount(cycle * 0.1)).toBe(0);
        expect(splitAmount(cycle * 0.95)).toBe(0);
    });

    it('is apart in the middle of its cycle', () => {
        expect(splitAmount(cycle * 0.55)).toBeGreaterThan(0.15);
    });

    it('stays within reach and repeats', () => {
        for (const t of moments) {
            expect(splitAmount(t)).toBeGreaterThanOrEqual(0);
            expect(splitAmount(t)).toBeLessThan(0.19);
        }
    });

    it('twists as it parts, and untwists as it closes', () => {
        const before = coinPose('split', 0, cycle * 0.1).cutAt;
        const during = coinPose('split', 0, cycle * 0.55).cutAt;
        const after = coinPose('split', 0, cycle * 0.95).cutAt;
        expect(during - before).toBeGreaterThan(0.5);
        expect(after - before).toBeLessThan(0.5);
    });

    it('parts and closes without a jump', () => {
        const step = 0.02;
        for (let t = 0; t < cycle * 2; t += step) {
            expect(Math.abs(splitAmount(t + step) - splitAmount(t))).toBeLessThan(0.005);
        }
    });
});
