import { describe, expect, it } from 'vitest';
import { frameIsDue, Governor, LOWEST_LEVEL, nextFrameDue, QUALITY, type GovernorEvent, isSoftwareRenderer } from '@/lib/glass/governor';

const WINDOW = 40;

function feed(governor: Governor, ms: number, windows = 1): GovernorEvent[] {
    const events: GovernorEvent[] = [];
    for (let i = 0; i < windows * WINDOW; i++) {
        const event = governor.sample(ms);
        if (event) events.push(event);
    }
    return events;
}

describe('the quality levels', () => {
    it('only ever get cheaper going down', () => {
        for (let i = 1; i < QUALITY.length; i++) {
            expect(QUALITY[i].dpr).toBeLessThan(QUALITY[i - 1].dpr);
            expect(QUALITY[i].liquid).toBeLessThanOrEqual(QUALITY[i - 1].liquid);
        }
    });
});

describe('the frame cap', () => {
    /** Runs a screen of this rate for ten seconds and counts how many frames were drawn. */
    function drawsPerSecond(hz: number, frameMs: number): number {
        let due = 0;
        let drawn = 0;
        for (let i = 1; i <= hz * 10; i++) {
            const now = (i * 1000) / hz;
            if (!frameIsDue(now, due)) continue;
            due = nextFrameDue(now, due, frameMs);
            drawn++;
        }
        return drawn / 10;
    }

    it.each([60, 90, 120, 144, 165, 240])('holds about 60 draws a second on a %i Hz screen', (hz) => {
        const rate = drawsPerSecond(hz, 16.7);
        expect(rate).toBeGreaterThan(55);
        expect(rate).toBeLessThanOrEqual(63);
    });

    it('never skips a frame on a 60 Hz screen, however long it runs', () => {
        expect(drawsPerSecond(60, 16.7)).toBe(60);
    });

    it('holds about 30 at the lowest level', () => {
        expect(drawsPerSecond(60, 33.4)).toBeCloseTo(30, 0);
        expect(drawsPerSecond(120, 33.4)).toBeCloseTo(30, 0);
    });

    it('does not race to catch up after a long stall', () => {
        const due = nextFrameDue(5000, 100, 16.7);
        expect(due).toBeGreaterThan(5000);
        expect(due).toBeLessThanOrEqual(5016.7);
    });
});

describe('the governor', () => {
    it('leaves a machine alone that keeps up', () => {
        const governor = new Governor();
        expect(feed(governor, 16.7, 50)).toEqual([]);
        expect(governor.level).toBe(0);
    });

    it('needs a whole window before it judges', () => {
        const governor = new Governor();
        for (let i = 0; i < WINDOW - 1; i++) expect(governor.sample(60)).toBeNull();
        expect(governor.sample(60)).toBe('drop');
    });

    it('forgives a few slow frames and drops when there are many', () => {
        const fine = new Governor();
        for (let i = 0; i < WINDOW; i++) fine.sample(i < 8 ? 40 : 16.7);
        expect(fine.level).toBe(0);

        const slow = new Governor();
        for (let i = 0; i < WINDOW; i++) slow.sample(i < 9 ? 40 : 16.7);
        expect(slow.level).toBe(1);
    });

    it('ignores gaps that are not about drawing, such as a hidden tab', () => {
        const governor = new Governor();
        for (let i = 0; i < 30; i++) governor.sample(40);
        governor.sample(5000);
        for (let i = 0; i < 39; i++) expect(governor.sample(40)).toBeNull();
        expect(governor.level).toBe(0);
    });

    it('goes back up after a long smooth stretch', () => {
        const governor = new Governor(2);
        expect(feed(governor, 16.7, 7)).toEqual([]);
        expect(feed(governor, 16.7, 1)).toEqual(['raise']);
        expect(governor.level).toBe(1);
    });

    it('stops trying after two raises that failed, so the picture does not keep pulsing', () => {
        const governor = new Governor(1);
        // A phone that holds 16.7 ms at level 1 but not at level 0.
        const events: GovernorEvent[] = [];
        for (let i = 0; i < 400 * WINDOW; i++) {
            const event = governor.sample(governor.level === 0 ? 30 : 16.7);
            if (event) events.push(event);
        }
        expect(events.filter((e) => e === 'raise')).toHaveLength(2);
        expect(governor.level).toBe(1);
    });

    it('waits longer after each raise that failed', () => {
        const governor = new Governor(1);
        expect(feed(governor, 16.7, 8)).toEqual(['raise']);
        expect(feed(governor, 30, 1)).toEqual(['drop']);
        // Lower quality fixed it, so it stays down: twice the wait this time.
        expect(feed(governor, 16.7, 15)).toEqual([]);
        expect(feed(governor, 16.7, 1)).toEqual(['raise']);
    });

    it('puts the quality back when dropping it changed nothing, and accepts that frame rate', () => {
        // Battery saver: 30 fps whatever the engine does.
        const governor = new Governor();
        expect(feed(governor, 33.3, 1)).toEqual(['drop']);
        expect(feed(governor, 33.3, 1)).toEqual(['undo-drop']);
        expect(governor.level).toBe(0);
        expect(governor.capMs).toBeCloseTo(33.3);
        expect(feed(governor, 33.3, 20)).toEqual([]);
        expect(governor.level).toBe(0);
    });

    it('keeps dropping when only some frames are slow, though the frame cap hides any gain in the typical one', () => {
        // Seen on an overloaded laptop: most frames on time at every level, a quarter of them not.
        const governor = new Governor();
        const window = () => {
            const events: GovernorEvent[] = [];
            for (let i = 0; i < WINDOW; i++) {
                const event = governor.sample(i < 12 ? 36 : 18);
                if (event) events.push(event);
            }
            return events;
        };
        expect(window()).toEqual(['drop']);
        expect(window()).toEqual(['drop']);
        expect(governor.level).toBe(2);
        expect(governor.capMs).toBe(0);
    });

    it('keeps a drop that helped', () => {
        const governor = new Governor();
        expect(feed(governor, 40, 1)).toEqual(['drop']);
        expect(feed(governor, 16.7, 1)).toEqual([]);
        expect(governor.level).toBe(1);
        expect(governor.capMs).toBe(0);
    });

    it('walks down a level at a time while each drop helps a little', () => {
        const governor = new Governor();
        let ms = 80;
        while (governor.level < LOWEST_LEVEL) {
            feed(governor, ms, 1);
            ms *= 0.8;
        }
        expect(governor.level).toBe(LOWEST_LEVEL);
    });

    it('asks for Calm when even the lowest level cannot keep up', () => {
        const governor = new Governor(LOWEST_LEVEL);
        const events = feed(governor, 120, 3);
        expect(events).toEqual(['calm']);
    });

    it('gives the lowest level more time per frame, so 30 fps there is not slow', () => {
        const governor = new Governor(LOWEST_LEVEL);
        expect(governor.targetMs).toBeCloseTo(33.4);
        expect(feed(governor, 33.4, 3)).toEqual([]);
    });
});

describe('a renderer that is really the CPU', () => {
    it.each([
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
        'Google SwiftShader',
        'llvmpipe (LLVM 15.0.7, 256 bits)',
        'Mesa softpipe',
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ])('%s counts as no GPU', (name) => {
        expect(isSoftwareRenderer(name)).toBe(true);
    });

    it.each([
        'ANGLE (Intel, Intel(R) UHD Graphics (0x00004688) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'Adreno (TM) 730',
        'Mali-G710',
        'Apple GPU',
        '',
    ])('%s is left to the engine', (name) => {
        expect(isSoftwareRenderer(name)).toBe(false);
    });

    it('leaves an unknown renderer to the engine', () => {
        expect(isSoftwareRenderer(null)).toBe(false);
        expect(isSoftwareRenderer(undefined)).toBe(false);
    });
});
