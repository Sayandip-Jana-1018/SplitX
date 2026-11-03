import { describe, expect, it } from 'vitest';
import { GLASS_KINDS, GLASS_STYLE_IDS, surfaceLook } from '@/lib/glass/styles';

describe('what a surface looks like', () => {
    it('gives every kind under every style a look the shader can use', () => {
        for (const style of GLASS_STYLE_IDS) {
            for (const kind of GLASS_KINDS) {
                const look = surfaceLook(kind, style);
                expect(look.frost, `${style} ${kind}`).toBeGreaterThanOrEqual(0);
                expect(look.frost, `${style} ${kind}`).toBeLessThanOrEqual(1);
                expect(Math.abs(look.tint), `${style} ${kind}`).toBeLessThanOrEqual(1);
                for (const value of Object.values(look)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
            }
        }
    });

    it('frosts frosted glass more than liquid, and crystal least of all', () => {
        expect(surfaceLook('reg', 'frosted').frost).toBeGreaterThan(surfaceLook('reg', 'liquid').frost);
        expect(surfaceLook('reg', 'crystal').frost).toBeLessThan(surfaceLook('reg', 'liquid').frost);
    });

    it('keeps an accent surface in the accent colour under every style', () => {
        for (const style of GLASS_STYLE_IDS) expect(surfaceLook('accent', style).tint).toBeLessThan(0);
    });

    it('colours everything but clear glass when the style is tinted', () => {
        expect(surfaceLook('reg', 'tinted').colored).toBe(true);
        expect(surfaceLook('thick', 'tinted').tint).toBeLessThanOrEqual(0.72);
        expect(surfaceLook('clear', 'tinted').colored).toBe(false);
        expect(surfaceLook('accent', 'tinted').colored).toBe(false);
    });

    it('treats what it does not recognise as regular liquid glass', () => {
        expect(surfaceLook('nonsense', 'nonsense')).toEqual(surfaceLook('reg', 'liquid'));
        expect(surfaceLook(null, undefined)).toEqual(surfaceLook('reg', 'liquid'));
    });
});
