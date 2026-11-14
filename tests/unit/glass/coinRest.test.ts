import { describe, expect, it } from 'vitest';
import { blendPose, coinPose, restingPose } from '@/lib/glass/coins';

describe('a coin at rest (calm motion, phone app)', () => {
    it('faces you square on and upright', () => {
        for (const kind of ['coin', 'rim'] as const) {
            const pose = restingPose(kind, 3);
            expect(pose.facing).toBeCloseTo(1);
            expect(pose.lean).toBeCloseTo(0);
            expect(pose.spin).toBeCloseTo(0);
        }
        expect(restingPose('split', 1).cut).toBe(0);
    });

    it('is reached from any moment of the spin, smoothly, the short way round', () => {
        const moving = coinPose('rim', 2, 37.4);
        const rest = restingPose('rim', 2);
        expect(blendPose(moving, rest, 0)).toEqual(moving);
        const end = blendPose(moving, rest, 1);
        expect(end.facing).toBeCloseTo(rest.facing);
        expect(Math.cos(end.spin - rest.spin)).toBeCloseTo(1);
        // Halfway, it has turned no more than half a turn.
        const half = blendPose({ ...moving, spin: 3 }, { ...rest, spin: -3 }, 0.5);
        expect(Math.abs(half.spin - 3)).toBeLessThan(Math.PI / 2);
        expect(Math.hypot(half.axisX, half.axisY)).toBeCloseTo(1);
    });
});
